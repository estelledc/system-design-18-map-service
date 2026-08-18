import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactContract,
  canonicalStringify,
  normalizeGraphBuild,
  normalizeOverlay,
  normalizeRoute,
  webMercatorTile,
} from '../../src/contracts.js';
import { graphA, routeRequest } from '../../src/fixtures.js';

test('canonical JSON and graph normalization are order-stable', () => {
  const reversed = {
    sourceRevision: graphA.sourceRevision,
    graph: { nodes: [...graphA.graph.nodes].reverse(), edges: [...graphA.graph.edges].reverse() },
  };
  assert.equal(
    canonicalStringify(normalizeGraphBuild(graphA)),
    canonicalStringify(normalizeGraphBuild(reversed)),
  );
});

test('graph input rejects unknown fields, duplicate IDs, and the Web Mercator polar gap', () => {
  assert.throws(() => normalizeGraphBuild({ ...graphA, extra: true }), /exactly/);
  assert.throws(() => normalizeGraphBuild({
    ...graphA,
    graph: { ...graphA.graph, nodes: [graphA.graph.nodes[0], graphA.graph.nodes[0]] },
  }), /unique/);
  assert.throws(() => normalizeGraphBuild({
    ...graphA,
    graph: {
      ...graphA.graph,
      nodes: [{ ...graphA.graph.nodes[0], latitudeE7: 850_511_288 }, ...graphA.graph.nodes.slice(1)],
    },
  }), /safe integer/);
});

test('WebMercatorQuad addressing has bounded z/x/y semantics', () => {
  assert.deepEqual(webMercatorTile({ latitudeE7: 0, longitudeE7: 0 }, 0), { z: 0, x: 0, y: 0 });
  assert.deepEqual(webMercatorTile({ latitudeE7: 0, longitudeE7: 0 }, 2), { z: 2, x: 2, y: 2 });
  assert.deepEqual(webMercatorTile({ latitudeE7: 0, longitudeE7: -1_800_000_000 }, 2), { z: 2, x: 0, y: 2 });
  assert.equal(artifactContract.tileMatrix, 'WebMercatorQuad');
  assert.equal(artifactContract.tileZoom, 2);
});

test('route and overlay contracts reject silent defaults and ambiguous values', () => {
  assert.deepEqual(normalizeRoute(routeRequest), routeRequest);
  assert.throws(() => normalizeRoute({ ...routeRequest, mode: 'walk' }), /drive/);
  assert.throws(() => normalizeRoute({ ...routeRequest, maxExpansions: 0 }), /safe integer/);
  assert.deepEqual(normalizeOverlay({
    buildGeneration: `gen_${'a'.repeat(32)}`,
    delays: [{ edgeId: 'edge-b', delayMillis: 2 }, { edgeId: 'edge-a', delayMillis: 1 }],
    activatesAfterSeconds: 0,
    ttlSeconds: 60,
  }).delays.map((entry) => entry.edgeId), ['edge-a', 'edge-b']);
  assert.throws(() => normalizeOverlay({
    buildGeneration: `gen_${'a'.repeat(32)}`,
    delays: [{ edgeId: 'edge-a', delayMillis: 1 }, { edgeId: 'edge-a', delayMillis: 2 }],
    activatesAfterSeconds: 0,
    ttlSeconds: 60,
  }), /unique/);
});
