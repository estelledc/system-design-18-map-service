import assert from 'node:assert/strict';
import test from 'node:test';
import { dijkstraRoute, exhaustiveShortestCost, verifyRoute } from '../../src/routing.js';
import { graphA, routeRequest } from '../../src/fixtures.js';

test('bounded Dijkstra returns a connected deterministic optimum and applies one overlay', () => {
  const base = dijkstraRoute(graphA.graph, undefined, routeRequest);
  assert.deepEqual(base, {
    outcome: 'route_found',
    expansions: 4,
    totalCostMillis: 20,
    nodeIds: ['alpha', 'bravo', 'delta'],
    edgeIds: ['alpha-bravo', 'bravo-delta'],
  });
  assert.equal(verifyRoute(graphA.graph, undefined, routeRequest, base), true);

  const overlay = { delays: [{ edgeId: 'alpha-bravo', delayMillis: 100 }] };
  const rerouted = dijkstraRoute(graphA.graph, overlay, routeRequest);
  assert.equal(rerouted.totalCostMillis, 48);
  assert.deepEqual(rerouted.nodeIds, ['alpha', 'charlie', 'delta']);
  assert.equal(verifyRoute(graphA.graph, overlay, routeRequest, rerouted), true);
});

test('work exhaustion is explicit and never mislabeled no-route or optimal', () => {
  const result = dijkstraRoute(graphA.graph, undefined, { ...routeRequest, maxExpansions: 1 });
  assert.deepEqual(result, { outcome: 'work_limit', expansions: 1 });
});

test('disconnected graph returns no_route after exhausting the reachable set', () => {
  const graph = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ id: 'ab', from: 'a', to: 'b', baseCostMillis: 1, modes: ['drive'] }],
  };
  const request = { ...routeRequest, sourceNodeId: 'a', targetNodeId: 'c', maxExpansions: 10 };
  assert.deepEqual(dijkstraRoute(graph, undefined, request), { outcome: 'no_route', expansions: 2 });
  assert.equal(exhaustiveShortestCost(graph, undefined, request), null);
});

test('generated small graphs agree with exhaustive simple-path oracle', () => {
  let state = 0x18_5eed;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  for (let sample = 0; sample < 240; sample += 1) {
    const count = 2 + Math.floor(random() * 6);
    const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}` }));
    const edges = [];
    for (let from = 0; from < count; from += 1) {
      for (let to = 0; to < count; to += 1) {
        if (from !== to && random() < 0.34) {
          edges.push({
            id: `e${from}-${to}`,
            from: `n${from}`,
            to: `n${to}`,
            baseCostMillis: 1 + Math.floor(random() * 40),
            modes: ['drive'],
          });
        }
      }
    }
    const graph = { nodes, edges };
    const delays = edges.filter(() => random() < 0.2).map((edge) => ({ edgeId: edge.id, delayMillis: Math.floor(random() * 8) }));
    const overlay = { delays };
    const request = {
      sourceNodeId: 'n0',
      targetNodeId: `n${count - 1}`,
      mode: 'drive',
      overlayPolicy: 'base_fallback',
      maxExpansions: 1_000,
    };
    const expected = exhaustiveShortestCost(graph, overlay, request);
    const actual = dijkstraRoute(graph, overlay, request);
    if (expected === null) assert.equal(actual.outcome, 'no_route', `sample ${sample}`);
    else {
      assert.equal(actual.outcome, 'route_found', `sample ${sample}`);
      assert.equal(actual.totalCostMillis, expected, `sample ${sample}`);
      assert.equal(verifyRoute(graph, overlay, request, actual), true, `sample ${sample}`);
    }
  }
});
