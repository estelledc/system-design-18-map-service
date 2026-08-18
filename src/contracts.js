import { sha256 } from './crypto.js';
import { invalid } from './errors.js';

export const limits = Object.freeze({
  bodyBytes: 256 * 1024,
  sourceRevisionChars: 64,
  requestKeyChars: 128,
  nodeIdChars: 48,
  edgeIdChars: 64,
  maximumNodes: 2_000,
  maximumEdges: 10_000,
  maximumOverlayDelays: 10_000,
  maximumCostMillis: 1_000_000_000,
  maximumRouteCostMillis: 9_000_000_000_000,
  minimumRouteExpansions: 1,
  maximumRouteExpansions: 100_000,
  minimumOverlayTtlSeconds: 1,
  maximumOverlayTtlSeconds: 86_400,
  maximumOverlayDelaySeconds: 3_600,
  tileZoom: 2,
  webMercatorLatitudeE7: 850_511_287,
});

export const artifactContract = Object.freeze({
  builder: 'map-lab-builder-v1',
  tileMatrix: 'WebMercatorQuad',
  style: 'synthetic-v1',
  tileZoom: limits.tileZoom,
  mediaType: 'application/vnd.map-lab.tile+json',
});

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw invalid(`${name} must be a JSON object`);
  }
  return value;
}

export function exactKeys(value, expected, name) {
  plainObject(value, name);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw invalid(`${name} must contain exactly: ${wanted.join(', ')}`);
  }
  return value;
}

function boundedText(value, name, maximum, pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || !pattern.test(value)) {
    throw invalid(`${name} is invalid`);
  }
  return value;
}

function safeInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalid(`${name} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export function validateRequestKey(value) {
  return boundedText(value, 'Idempotency-Key', limits.requestKeyChars, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
}

export function validateUuid(value, name = 'resource ID') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw invalid(`${name} is invalid`);
  }
  return value;
}

export function canonicalStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('canonical JSON cannot contain NaN or infinity');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  plainObject(value, 'canonical value');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

export function canonicalBytes(value) {
  return Buffer.from(`${canonicalStringify(value)}\n`, 'utf8');
}

export function digestValue(value) {
  return sha256(canonicalBytes(value));
}

export function normalizeGraphBuild(body) {
  exactKeys(body, ['sourceRevision', 'graph'], 'build body');
  boundedText(body.sourceRevision, 'sourceRevision', limits.sourceRevisionChars);
  exactKeys(body.graph, ['nodes', 'edges'], 'graph');
  if (!Array.isArray(body.graph.nodes) || body.graph.nodes.length < 2 || body.graph.nodes.length > limits.maximumNodes) {
    throw invalid(`graph.nodes must contain 2 through ${limits.maximumNodes} nodes`);
  }
  if (!Array.isArray(body.graph.edges) || body.graph.edges.length < 1 || body.graph.edges.length > limits.maximumEdges) {
    throw invalid(`graph.edges must contain 1 through ${limits.maximumEdges} edges`);
  }

  const nodes = body.graph.nodes.map((raw, index) => {
    exactKeys(raw, ['id', 'latitudeE7', 'longitudeE7'], `graph.nodes[${index}]`);
    return {
      id: boundedText(raw.id, `graph.nodes[${index}].id`, limits.nodeIdChars),
      latitudeE7: safeInteger(
        raw.latitudeE7,
        `graph.nodes[${index}].latitudeE7`,
        -limits.webMercatorLatitudeE7,
        limits.webMercatorLatitudeE7,
      ),
      longitudeE7: safeInteger(raw.longitudeE7, `graph.nodes[${index}].longitudeE7`, -1_800_000_000, 1_799_999_999),
    };
  }).sort((left, right) => compareText(left.id, right.id));
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw invalid('node IDs must be unique');
  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = body.graph.edges.map((raw, index) => {
    exactKeys(raw, ['id', 'from', 'to', 'baseCostMillis', 'modes'], `graph.edges[${index}]`);
    const id = boundedText(raw.id, `graph.edges[${index}].id`, limits.edgeIdChars);
    const from = boundedText(raw.from, `graph.edges[${index}].from`, limits.nodeIdChars);
    const to = boundedText(raw.to, `graph.edges[${index}].to`, limits.nodeIdChars);
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw invalid(`graph.edges[${index}] references an unknown node`);
    if (from === to) throw invalid(`graph.edges[${index}] must not be a self-loop`);
    if (!Array.isArray(raw.modes) || raw.modes.length !== 1 || raw.modes[0] !== 'drive') {
      throw invalid(`graph.edges[${index}].modes must be exactly ["drive"]`);
    }
    return {
      id,
      from,
      to,
      baseCostMillis: safeInteger(raw.baseCostMillis, `graph.edges[${index}].baseCostMillis`, 1, limits.maximumCostMillis),
      modes: ['drive'],
    };
  }).sort((left, right) => compareText(left.id, right.id));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw invalid('edge IDs must be unique');

  return {
    sourceRevision: body.sourceRevision,
    graph: { nodes, edges },
  };
}

export function normalizeOverlay(body) {
  exactKeys(body, ['buildGeneration', 'delays', 'activatesAfterSeconds', 'ttlSeconds'], 'overlay body');
  const buildGeneration = boundedText(body.buildGeneration, 'buildGeneration', 64, /^gen_[0-9a-f]{32}$/);
  if (!Array.isArray(body.delays) || body.delays.length > limits.maximumOverlayDelays) {
    throw invalid(`delays must contain at most ${limits.maximumOverlayDelays} entries`);
  }
  const delays = body.delays.map((raw, index) => {
    exactKeys(raw, ['edgeId', 'delayMillis'], `delays[${index}]`);
    return {
      edgeId: boundedText(raw.edgeId, `delays[${index}].edgeId`, limits.edgeIdChars),
      delayMillis: safeInteger(raw.delayMillis, `delays[${index}].delayMillis`, 0, limits.maximumCostMillis),
    };
  }).sort((left, right) => compareText(left.edgeId, right.edgeId));
  if (new Set(delays.map((entry) => entry.edgeId)).size !== delays.length) throw invalid('overlay edge IDs must be unique');
  return {
    buildGeneration,
    delays,
    activatesAfterSeconds: safeInteger(
      body.activatesAfterSeconds,
      'activatesAfterSeconds',
      0,
      limits.maximumOverlayDelaySeconds,
    ),
    ttlSeconds: safeInteger(
      body.ttlSeconds,
      'ttlSeconds',
      limits.minimumOverlayTtlSeconds,
      limits.maximumOverlayTtlSeconds,
    ),
  };
}

export function normalizeRoute(body) {
  exactKeys(body, ['sourceNodeId', 'targetNodeId', 'mode', 'overlayPolicy', 'maxExpansions'], 'route body');
  const sourceNodeId = boundedText(body.sourceNodeId, 'sourceNodeId', limits.nodeIdChars);
  const targetNodeId = boundedText(body.targetNodeId, 'targetNodeId', limits.nodeIdChars);
  if (sourceNodeId === targetNodeId) throw invalid('sourceNodeId and targetNodeId must differ');
  if (body.mode !== 'drive') throw invalid('mode must be drive');
  if (!['require_current', 'base_fallback'].includes(body.overlayPolicy)) {
    throw invalid('overlayPolicy must be require_current or base_fallback');
  }
  return {
    sourceNodeId,
    targetNodeId,
    mode: 'drive',
    overlayPolicy: body.overlayPolicy,
    maxExpansions: safeInteger(
      body.maxExpansions,
      'maxExpansions',
      limits.minimumRouteExpansions,
      limits.maximumRouteExpansions,
    ),
  };
}

export function webMercatorTile({ latitudeE7, longitudeE7 }, zoom = limits.tileZoom) {
  safeInteger(zoom, 'zoom', 0, 24);
  const latitude = latitudeE7 / 10_000_000;
  const longitude = longitudeE7 / 10_000_000;
  const size = 2 ** zoom;
  const radians = latitude * Math.PI / 180;
  const x = Math.floor(((longitude + 180) / 360) * size);
  const yUnclamped = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size);
  return { z: zoom, x: Math.min(size - 1, Math.max(0, x)), y: Math.min(size - 1, Math.max(0, yUnclamped)) };
}

export function artifactLogicalKey({ z, x, y }) {
  return `${artifactContract.tileMatrix}/${artifactContract.style}/${z}/${x}/${y}`;
}

export function parseTileCoordinate(value, name, zoom) {
  if (!/^(0|[1-9][0-9]{0,7})$/.test(value)) throw invalid(`${name} is invalid`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number >= 2 ** zoom) throw invalid(`${name} is outside the tile matrix`);
  return number;
}
