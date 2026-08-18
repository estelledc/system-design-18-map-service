import {
  artifactContract,
  artifactLogicalKey,
  digestValue,
  normalizeGraphBuild,
  normalizeOverlay,
  normalizeRoute,
  parseTileCoordinate,
  validateRequestKey,
  validateUuid,
} from './contracts.js';
import { buildManifest, deriveGraphDocument, deriveTileDocuments } from './artifacts.js';
import { corrupted, invalid, notFound } from './errors.js';
import { dijkstraRoute, verifyRoute } from './routing.js';

function buildBody(build, replayed) {
  return {
    buildId: build.buildId,
    generation: build.generation,
    state: build.state,
    sourceDigest: build.sourceDigest,
    graphDigest: build.graphDigest,
    manifestDigest: build.manifestDigest,
    artifactCount: build.artifactCount,
    createdAt: build.createdAt.toISOString(),
    completedAt: build.completedAt?.toISOString() ?? null,
    replayed,
  };
}

function routeBody(route, replayed = route.replayed) {
  return {
    routeId: route.routeId,
    status: route.status,
    acceptedAt: route.acceptedAt.toISOString(),
    completedAt: route.completedAt?.toISOString() ?? null,
    snapshot: {
      stateRevision: route.stateRevision,
      generation: route.generation,
      graphDigest: route.graphDigest,
      overlayResolution: route.overlayResolution,
      overlayDigest: route.overlayDigest,
      overlayEffectiveAt: route.overlayEffectiveAt?.toISOString() ?? null,
      overlayExpiresAt: route.overlayExpiresAt?.toISOString() ?? null,
    },
    request: route.request,
    result: route.result,
    replayed,
  };
}

export class MapService {
  constructor(repository, objectStore, { afterArtifactStored = async () => {} } = {}) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.afterArtifactStored = afterArtifactStored;
  }

  async build({ owner, requestKey, body }) {
    const key = validateRequestKey(requestKey);
    const normalized = normalizeGraphBuild(body);
    const sourceDigest = digestValue(normalized);
    const intentDigest = digestValue({
      operation: 'build',
      builderContract: artifactContract.builder,
      sourceDigest,
      artifactContract,
    });
    let build = await this.repository.beginBuild({
      owner,
      requestKey: key,
      intentDigest,
      sourceDigest,
      builderContract: artifactContract.builder,
    });
    if (build.state === 'complete') return { created: false, body: buildBody(build, true) };

    const graph = deriveGraphDocument(normalized, build.generation);
    const graphObject = await this.objectStore.putJson(graph);
    const graphArtifact = {
      kind: 'graph',
      logicalKey: 'graph/drive',
      mediaType: 'application/vnd.map-lab.graph+json',
      ...graphObject,
    };
    await this.afterArtifactStored({ kind: 'graph', buildCreated: build.created });

    const tileArtifacts = [];
    for (const tile of deriveTileDocuments(graph)) {
      const stored = await this.objectStore.putJson(tile.document);
      tileArtifacts.push({
        kind: 'tile',
        logicalKey: tile.logicalKey,
        mediaType: artifactContract.mediaType,
        ...stored,
      });
    }
    const manifest = buildManifest({ generation: build.generation, sourceDigest, graphArtifact, tileArtifacts });
    const manifestObject = await this.objectStore.putJson(manifest);
    const artifacts = [graphArtifact, ...tileArtifacts];
    for (const artifact of artifacts) {
      const bytes = await this.objectStore.read(artifact.digest);
      if (bytes.length !== artifact.bytes) throw corrupted();
    }
    const manifestBytes = await this.objectStore.read(manifestObject.digest);
    if (manifestBytes.length !== manifestObject.bytes) throw corrupted();

    build = await this.repository.completeBuild({
      buildId: build.buildId,
      graphDigest: graphObject.digest,
      manifestDigest: manifestObject.digest,
      artifacts,
      nodeIds: graph.nodes.map((node) => node.id),
    });
    return { created: true, body: buildBody(build, false) };
  }

  async getBuild(buildId) {
    const build = await this.repository.getBuildById(validateUuid(buildId, 'buildId'));
    return { body: buildBody(build, false) };
  }

  async publish({ owner, requestKey, expectedRevision, buildId }) {
    const key = validateRequestKey(requestKey);
    const targetBuildId = validateUuid(buildId, 'buildId');
    const digest = digestValue({ operation: 'publish', buildId: targetBuildId, expectedRevision });
    const result = await this.repository.publishBuild({
      owner,
      requestKey: key,
      digest,
      expectedRevision,
      buildId: targetBuildId,
    });
    return { body: result };
  }

  async rollback({ owner, requestKey, expectedRevision, body }) {
    const key = validateRequestKey(requestKey);
    if (!body || Object.keys(body).length !== 1 || typeof body.targetBuildId !== 'string') {
      throw invalid('rollback body must contain exactly targetBuildId');
    }
    const targetBuildId = validateUuid(body.targetBuildId, 'targetBuildId');
    const digest = digestValue({ operation: 'rollback', targetBuildId, expectedRevision });
    const result = await this.repository.rollbackToBuild({
      owner,
      requestKey: key,
      digest,
      expectedRevision,
      buildId: targetBuildId,
    });
    return { body: result };
  }

  async activateOverlay({ owner, requestKey, expectedRevision, body }) {
    const key = validateRequestKey(requestKey);
    const normalized = normalizeOverlay(body);
    const build = await this.repository.getBuildByGeneration(normalized.buildGeneration);
    if (build.state !== 'complete') throw notFound();
    const graph = await this.objectStore.readJson(build.graphDigest);
    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    if (normalized.delays.some((entry) => !edgeIds.has(entry.edgeId))) {
      throw invalid('overlay references an edge outside its compatible graph');
    }
    const document = {
      schemaVersion: 'map-lab.overlay.v1',
      generation: normalized.buildGeneration,
      delays: normalized.delays,
    };
    const overlayObject = await this.objectStore.putJson(document);
    const digest = digestValue({
      operation: 'activate_overlay',
      expectedRevision,
      normalized,
      overlayDigest: overlayObject.digest,
    });
    const result = await this.repository.activateOverlay({
      owner,
      requestKey: key,
      digest,
      expectedRevision,
      buildId: build.buildId,
      overlayObject,
      activatesAfterSeconds: normalized.activatesAfterSeconds,
      ttlSeconds: normalized.ttlSeconds,
    });
    return { body: result };
  }

  async route({ owner, requestKey, body }) {
    const key = validateRequestKey(requestKey);
    const request = normalizeRoute(body);
    const intentDigest = digestValue({ operation: 'route', request });
    let route = await this.repository.beginRoute({ owner, requestKey: key, intentDigest, request });
    const wasReplay = route.replayed;
    if (route.status === 'complete') return { created: false, body: routeBody(route, true) };

    const graph = await this.objectStore.readJson(route.graphDigest);
    if (graph.schemaVersion !== 'map-lab.graph.v1' || graph.generation !== route.generation) throw corrupted();
    let overlay;
    if (route.overlayDigest) {
      overlay = await this.objectStore.readJson(route.overlayDigest);
      if (overlay.schemaVersion !== 'map-lab.overlay.v1' || overlay.generation !== route.generation) throw corrupted();
    }
    const result = dijkstraRoute(graph, overlay, route.request);
    if (!verifyRoute(graph, overlay, route.request, result)) throw corrupted();
    route = await this.repository.completeRoute({ routeId: route.routeId, result });
    return { created: !wasReplay, body: routeBody(route, wasReplay) };
  }

  async getRoute({ owner, routeId }) {
    return { body: routeBody(await this.repository.getRoute({ owner, routeId: validateUuid(routeId, 'routeId') })) };
  }

  async current() {
    const state = await this.repository.getCurrentState();
    const overlayEffective = Boolean(
      state.overlayId
      && state.overlayEffectiveAt <= state.observedAt
      && state.observedAt < state.overlayExpiresAt,
    );
    return {
      body: {
        stateRevision: state.stateRevision,
        generation: state.generation,
        manifestDigest: state.manifestDigest,
        overlay: state.overlayId ? {
          digest: state.overlayDigest,
          effectiveAt: state.overlayEffectiveAt.toISOString(),
          expiresAt: state.overlayExpiresAt.toISOString(),
          effective: overlayEffective,
        } : null,
        observedAt: state.observedAt.toISOString(),
      },
    };
  }

  async tile({ generation, style, zText, xText, yText }) {
    if (!/^gen_[0-9a-f]{32}$/.test(generation)) throw invalid('generation is invalid');
    if (style !== artifactContract.style) throw notFound();
    if (zText !== String(artifactContract.tileZoom)) throw notFound();
    const z = artifactContract.tileZoom;
    const x = parseTileCoordinate(xText, 'x', z);
    const y = parseTileCoordinate(yText, 'y', z);
    const logicalKey = artifactLogicalKey({ z, x, y });
    const artifact = await this.repository.getArtifact({ generation, logicalKey });
    const bytes = await this.objectStore.read(artifact.digest);
    if (bytes.length !== artifact.bytes) throw corrupted();
    return { artifact, bytes };
  }
}
