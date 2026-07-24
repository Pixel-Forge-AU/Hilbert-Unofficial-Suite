export interface GraphEdge {
  from: string;
  to: string;
}

const UNVISITED = 0;
const VISITING = 1;
const VISITED = 2;

/** DFS cycle detection. Returns the first cycle found as an ordered id chain, or null if the graph is acyclic. */
export function detectCycle(edges: GraphEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const state = new Map<string, number>();
  const path: string[] = [];

  function visit(node: string): string[] | null {
    state.set(node, VISITING);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const nextState = state.get(next) ?? UNVISITED;
      if (nextState === VISITING) {
        const cycleStart = path.indexOf(next);
        return [...path.slice(cycleStart), next];
      }
      if (nextState === UNVISITED) {
        const found = visit(next);
        if (found) return found;
      }
    }
    path.pop();
    state.set(node, VISITED);
    return null;
  }

  for (const node of adjacency.keys()) {
    if ((state.get(node) ?? UNVISITED) === UNVISITED) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
