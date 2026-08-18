export const graphA = Object.freeze({
  sourceRevision: 'synthetic-region-a-revision-1',
  graph: {
    nodes: [
      { id: 'alpha', latitudeE7: 0, longitudeE7: -1_200_000_000 },
      { id: 'bravo', latitudeE7: 100_000_000, longitudeE7: -300_000_000 },
      { id: 'charlie', latitudeE7: -100_000_000, longitudeE7: 300_000_000 },
      { id: 'delta', latitudeE7: 0, longitudeE7: 1_200_000_000 },
    ],
    edges: [
      { id: 'alpha-bravo', from: 'alpha', to: 'bravo', baseCostMillis: 10, modes: ['drive'] },
      { id: 'bravo-delta', from: 'bravo', to: 'delta', baseCostMillis: 10, modes: ['drive'] },
      { id: 'alpha-charlie', from: 'alpha', to: 'charlie', baseCostMillis: 8, modes: ['drive'] },
      { id: 'charlie-delta', from: 'charlie', to: 'delta', baseCostMillis: 40, modes: ['drive'] },
      { id: 'bravo-charlie', from: 'bravo', to: 'charlie', baseCostMillis: 4, modes: ['drive'] },
    ],
  },
});

export const graphB = Object.freeze({
  sourceRevision: 'synthetic-region-a-revision-2',
  graph: {
    nodes: graphA.graph.nodes,
    edges: [
      { id: 'alpha-bravo', from: 'alpha', to: 'bravo', baseCostMillis: 20, modes: ['drive'] },
      { id: 'bravo-delta', from: 'bravo', to: 'delta', baseCostMillis: 20, modes: ['drive'] },
      { id: 'alpha-charlie', from: 'alpha', to: 'charlie', baseCostMillis: 5, modes: ['drive'] },
      { id: 'charlie-delta', from: 'charlie', to: 'delta', baseCostMillis: 5, modes: ['drive'] },
      { id: 'bravo-charlie', from: 'bravo', to: 'charlie', baseCostMillis: 4, modes: ['drive'] },
    ],
  },
});

export const routeRequest = Object.freeze({
  sourceNodeId: 'alpha',
  targetNodeId: 'delta',
  mode: 'drive',
  overlayPolicy: 'base_fallback',
  maxExpansions: 100,
});

export function gridGraph(side, sourceRevision = `synthetic-grid-${side}`) {
  const nodes = [];
  const edges = [];
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const id = `n-${row}-${column}`;
      nodes.push({
        id,
        latitudeE7: -600_000_000 + Math.floor((1_200_000_000 * row) / Math.max(1, side - 1)),
        longitudeE7: -1_600_000_000 + Math.floor((3_200_000_000 * column) / Math.max(1, side - 1)),
      });
      if (column > 0) {
        edges.push({ id: `e-${row}-${column - 1}-r`, from: `n-${row}-${column - 1}`, to: id, baseCostMillis: 10, modes: ['drive'] });
        edges.push({ id: `e-${row}-${column}-l`, from: id, to: `n-${row}-${column - 1}`, baseCostMillis: 10, modes: ['drive'] });
      }
      if (row > 0) {
        edges.push({ id: `e-${row - 1}-${column}-d`, from: `n-${row - 1}-${column}`, to: id, baseCostMillis: 11, modes: ['drive'] });
        edges.push({ id: `e-${row}-${column}-u`, from: id, to: `n-${row - 1}-${column}`, baseCostMillis: 11, modes: ['drive'] });
      }
    }
  }
  return { sourceRevision, graph: { nodes, edges } };
}
