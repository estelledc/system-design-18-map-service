import {
  artifactContract,
  artifactLogicalKey,
  canonicalBytes,
  compareText,
  digestValue,
  webMercatorTile,
} from './contracts.js';

export function deriveGraphDocument(normalized, generation) {
  return {
    schemaVersion: 'map-lab.graph.v1',
    generation,
    sourceRevision: normalized.sourceRevision,
    costContract: 'synthetic_time_ms_non_negative_v1',
    nodes: normalized.graph.nodes,
    edges: normalized.graph.edges,
  };
}

export function deriveTileDocuments(graph) {
  const groups = new Map();
  for (const node of graph.nodes) {
    const coordinate = webMercatorTile(node, artifactContract.tileZoom);
    const key = artifactLogicalKey(coordinate);
    if (!groups.has(key)) groups.set(key, { coordinate, nodes: [] });
    groups.get(key).nodes.push(node);
  }
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) outgoing.get(edge.from)?.push(edge);

  return [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([logicalKey, group]) => {
    const nodeIds = new Set(group.nodes.map((node) => node.id));
    const edges = [];
    for (const nodeId of [...nodeIds].sort(compareText)) edges.push(...outgoing.get(nodeId));
    edges.sort((left, right) => compareText(left.id, right.id));
    return {
      logicalKey,
      document: {
        schemaVersion: 'map-lab.tile.v1',
        generation: graph.generation,
        tileMatrix: artifactContract.tileMatrix,
        style: artifactContract.style,
        coordinate: group.coordinate,
        nodes: group.nodes.sort((left, right) => compareText(left.id, right.id)),
        outgoingEdges: edges,
      },
    };
  });
}

export function buildManifest({ generation, sourceDigest, graphArtifact, tileArtifacts }) {
  const artifacts = [graphArtifact, ...tileArtifacts]
    .map((artifact) => ({
      kind: artifact.kind,
      logicalKey: artifact.logicalKey,
      digest: artifact.digest,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
    }))
    .sort((left, right) => compareText(left.logicalKey, right.logicalKey));
  return {
    schemaVersion: 'map-lab.manifest.v1',
    generation,
    sourceDigest,
    builderContract: artifactContract.builder,
    tileContract: {
      tileMatrix: artifactContract.tileMatrix,
      style: artifactContract.style,
      zoom: artifactContract.tileZoom,
    },
    graphDigest: graphArtifact.digest,
    artifactCount: artifacts.length,
    artifacts,
  };
}

export function verifyCanonicalDocument(value, expectedDigest) {
  return digestValue(value) === expectedDigest && canonicalBytes(value).length > 0;
}
