import type { TaskDependency } from "@implementation-orchestrator/contracts";

export function findHardDependencyCycle(taskIds: string[], dependencies: TaskDependency[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const id of taskIds) {
    adjacency.set(id, []);
  }
  for (const dep of dependencies) {
    if (dep.type !== "hard") {
      continue;
    }
    const targets = adjacency.get(dep.fromTaskId);
    if (targets) {
      targets.push(dep.toTaskId);
    }
  }

  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function visit(node: string): string[] | null {
    visited.add(node);
    stack.push(node);
    onStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (onStack.has(neighbor)) {
        const cycleStart = stack.indexOf(neighbor);
        return [...stack.slice(cycleStart), neighbor];
      }
      if (!visited.has(neighbor)) {
        const found = visit(neighbor);
        if (found) {
          return found;
        }
      }
    }

    stack.pop();
    onStack.delete(node);
    return null;
  }

  for (const id of taskIds) {
    if (!visited.has(id)) {
      const found = visit(id);
      if (found) {
        return found;
      }
    }
  }

  return null;
}
