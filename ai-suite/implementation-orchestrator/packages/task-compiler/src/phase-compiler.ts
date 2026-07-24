import type { ExecutableTask, ExecutionPhase } from "@implementation-orchestrator/contracts";
import type { CompilerContext } from "./compiler-context.js";
import { UNPHASED_PHASE_ID } from "./feature-compiler.js";

export function compilePhases(context: CompilerContext, tasks: ExecutableTask[]): ExecutionPhase[] {
  const taskIdsByPhase = new Map<string, string[]>();
  for (const task of tasks) {
    const list = taskIdsByPhase.get(task.phaseId) ?? [];
    list.push(task.id);
    taskIdsByPhase.set(task.phaseId, list);
  }

  const phases: ExecutionPhase[] = [];

  if (taskIdsByPhase.has("setup")) {
    phases.push({ id: "setup", name: "Repository Setup", order: -1, taskIds: taskIdsByPhase.get("setup")! });
  }

  const manifestOrders = context.manifest.phases.map((p) => p.order);
  const maxManifestOrder = manifestOrders.length > 0 ? Math.max(...manifestOrders) : 0;

  for (const phase of [...context.manifest.phases].sort((a, b) => a.order - b.order)) {
    phases.push({
      id: phase.id,
      name: phase.name,
      order: phase.order,
      taskIds: taskIdsByPhase.get(phase.id) ?? [],
    });
  }

  let cursor = maxManifestOrder;

  if (taskIdsByPhase.has(UNPHASED_PHASE_ID)) {
    cursor += 1;
    phases.push({
      id: UNPHASED_PHASE_ID,
      name: "Unphased Features",
      order: cursor,
      taskIds: taskIdsByPhase.get(UNPHASED_PHASE_ID)!,
    });
  }

  if (taskIdsByPhase.has("integration")) {
    cursor += 1;
    phases.push({
      id: "integration",
      name: "Integration Verification",
      order: cursor,
      taskIds: taskIdsByPhase.get("integration")!,
    });
  }

  cursor += 1;
  phases.push({
    id: "final-verification",
    name: "Final Verification",
    order: cursor,
    taskIds: taskIdsByPhase.get("final-verification") ?? [],
  });

  return phases;
}
