import { compareText, limits } from './contracts.js';
import { invalid } from './errors.js';

function graphIndex(graph, overlay = undefined) {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const delayByEdge = new Map((overlay?.delays ?? []).map((entry) => [entry.edgeId, entry.delayMillis]));
  const outgoing = new Map([...nodes].map((nodeId) => [nodeId, []]));
  const edges = new Map();
  for (const edge of graph.edges) {
    const delay = delayByEdge.get(edge.id) ?? 0;
    const costMillis = edge.baseCostMillis + delay;
    if (!Number.isSafeInteger(costMillis) || costMillis < 1 || costMillis > limits.maximumRouteCostMillis) {
      throw invalid('edge cost is outside the supported safe range');
    }
    const indexed = { ...edge, costMillis };
    edges.set(edge.id, indexed);
    outgoing.get(edge.from)?.push(indexed);
  }
  for (const values of outgoing.values()) {
    values.sort((left, right) => compareText(left.to, right.to) || compareText(left.id, right.id));
  }
  return { nodes, outgoing, edges };
}

class MinQueue {
  constructor() {
    this.values = [];
  }

  push(value) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareQueue(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop() {
    if (!this.values.length) return undefined;
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        let child = left;
        if (right < this.values.length && compareQueue(this.values[right], this.values[left]) < 0) child = right;
        if (compareQueue(last, this.values[child]) <= 0) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

function compareQueue(left, right) {
  return left.cost - right.cost || compareText(left.nodeId, right.nodeId) || compareText(left.pathKey, right.pathKey);
}

function checkedAdd(left, right) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum > limits.maximumRouteCostMillis) throw invalid('route cost overflowed');
  return sum;
}

export function dijkstraRoute(graph, overlay, request) {
  const index = graphIndex(graph, overlay);
  if (!index.nodes.has(request.sourceNodeId) || !index.nodes.has(request.targetNodeId)) {
    throw invalid('route endpoint is not present in the frozen graph');
  }

  const queue = new MinQueue();
  const best = new Map([[request.sourceNodeId, { cost: 0, pathKey: request.sourceNodeId }]]);
  const previous = new Map();
  queue.push({ nodeId: request.sourceNodeId, cost: 0, pathKey: request.sourceNodeId });
  let expansions = 0;

  while (queue.values.length) {
    if (expansions >= request.maxExpansions) return { outcome: 'work_limit', expansions };
    const current = queue.pop();
    const known = best.get(current.nodeId);
    if (!known || known.cost !== current.cost || known.pathKey !== current.pathKey) continue;
    expansions += 1;
    if (current.nodeId === request.targetNodeId) {
      const edgeIds = [];
      const nodeIds = [current.nodeId];
      let cursor = current.nodeId;
      while (cursor !== request.sourceNodeId) {
        const step = previous.get(cursor);
        if (!step) throw new Error('route predecessor chain is incomplete');
        edgeIds.push(step.edgeId);
        cursor = step.nodeId;
        nodeIds.push(cursor);
      }
      edgeIds.reverse();
      nodeIds.reverse();
      return { outcome: 'route_found', expansions, totalCostMillis: current.cost, nodeIds, edgeIds };
    }

    for (const edge of index.outgoing.get(current.nodeId)) {
      if (!edge.modes.includes(request.mode)) continue;
      const cost = checkedAdd(current.cost, edge.costMillis);
      const pathKey = `${current.pathKey}\0${edge.id}\0${edge.to}`;
      const prior = best.get(edge.to);
      if (!prior || cost < prior.cost || (cost === prior.cost && pathKey < prior.pathKey)) {
        best.set(edge.to, { cost, pathKey });
        previous.set(edge.to, { nodeId: current.nodeId, edgeId: edge.id });
        queue.push({ nodeId: edge.to, cost, pathKey });
      }
    }
  }
  return { outcome: 'no_route', expansions };
}

export function verifyRoute(graph, overlay, request, result) {
  if (result.outcome !== 'route_found') return true;
  if (result.nodeIds[0] !== request.sourceNodeId || result.nodeIds.at(-1) !== request.targetNodeId) return false;
  if (result.edgeIds.length + 1 !== result.nodeIds.length) return false;
  const index = graphIndex(graph, overlay);
  let total = 0;
  for (let offset = 0; offset < result.edgeIds.length; offset += 1) {
    const edge = index.edges.get(result.edgeIds[offset]);
    if (!edge || edge.from !== result.nodeIds[offset] || edge.to !== result.nodeIds[offset + 1]) return false;
    if (!edge.modes.includes(request.mode)) return false;
    total = checkedAdd(total, edge.costMillis);
  }
  return total === result.totalCostMillis;
}

export function exhaustiveShortestCost(graph, overlay, request) {
  const index = graphIndex(graph, overlay);
  if (!index.nodes.has(request.sourceNodeId) || !index.nodes.has(request.targetNodeId)) return null;
  let best = null;
  const visited = new Set([request.sourceNodeId]);
  const visit = (nodeId, cost) => {
    if (best !== null && cost >= best) return;
    if (nodeId === request.targetNodeId) {
      best = cost;
      return;
    }
    for (const edge of index.outgoing.get(nodeId)) {
      if (!edge.modes.includes(request.mode) || visited.has(edge.to)) continue;
      visited.add(edge.to);
      visit(edge.to, checkedAdd(cost, edge.costMillis));
      visited.delete(edge.to);
    }
  };
  visit(request.sourceNodeId, 0);
  return best;
}
