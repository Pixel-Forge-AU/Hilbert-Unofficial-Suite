import type { ExecutableTask, ExecutionPhase, TaskDependency } from "@implementation-orchestrator/contracts";
import { MIGRATION_TASK_ID, SETUP_TASK_ID } from "./feature-compiler.js";

const NON_ORDERED_PHASE_IDS = new Set(["setup", "integration", "final-verification"]);

function edgeKey(edge: TaskDependency): string {
  return `${edge.fromTaskId}->${edge.toTaskId}:${edge.type}`;
}

export function buildDependencies(tasks: ExecutableTask[], phases: ExecutionPhase[]): TaskDependency[] {
  const edges: TaskDependency[] = [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const phaseOrderById = new Map(phases.map((p) => [p.id, p.order]));

  for (const task of tasks) {
    for (const depId of task.dependencies) {
      edges.push({ fromTaskId: task.id, toTaskId: depId, type: "hard", reason: "explicit task dependency" });
    }
  }

  if (taskById.has(SETUP_TASK_ID)) {
    for (const task of tasks) {
      if (task.id === SETUP_TASK_ID || task.id === MIGRATION_TASK_ID) {
        continue;
      }
      edges.push({
        fromTaskId: task.id,
        toTaskId: SETUP_TASK_ID,
        type: "hard",
        reason: "requires project dependencies to be installed",
      });
    }
  }

  if (taskById.has(MIGRATION_TASK_ID)) {
    for (const task of tasks) {
      if (task.category === "database" && task.id !== MIGRATION_TASK_ID) {
        edges.push({
          fromTaskId: task.id,
          toTaskId: MIGRATION_TASK_ID,
          type: "hard",
          reason: "database changes require migrations to be applied first",
        });
      }
    }
  }

  for (const task of tasks) {
    if (NON_ORDERED_PHASE_IDS.has(task.phaseId)) {
      continue;
    }
    const taskPhaseOrder = phaseOrderById.get(task.phaseId);
    if (taskPhaseOrder === undefined) {
      continue;
    }
    for (const other of tasks) {
      if (other.id === task.id || NON_ORDERED_PHASE_IDS.has(other.phaseId)) {
        continue;
      }
      const otherPhaseOrder = phaseOrderById.get(other.phaseId);
      if (otherPhaseOrder !== undefined && otherPhaseOrder < taskPhaseOrder) {
        edges.push({
          fromTaskId: task.id,
          toTaskId: other.id,
          type: "soft",
          reason: "prefer scheduling earlier implementation phases first",
        });
      }
    }
  }

  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (edge.fromTaskId === edge.toTaskId) {
      return false;
    }
    const key = edgeKey(edge);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function finalizeHardDependencies(tasks: ExecutableTask[], dependencies: TaskDependency[]): ExecutableTask[] {
  const hardTargetsByTask = new Map<string, Set<string>>();
  for (const edge of dependencies) {
    if (edge.type !== "hard") {
      continue;
    }
    const set = hardTargetsByTask.get(edge.fromTaskId) ?? new Set<string>();
    set.add(edge.toTaskId);
    hardTargetsByTask.set(edge.fromTaskId, set);
  }

  return tasks.map((task) => ({
    ...task,
    dependencies: [...(hardTargetsByTask.get(task.id) ?? new Set<string>())],
  }));
}
