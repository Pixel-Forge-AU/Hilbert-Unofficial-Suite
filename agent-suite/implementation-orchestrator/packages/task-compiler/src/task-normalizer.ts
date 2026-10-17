import { ExecutableTaskSchema, type ExecutableTask } from "@implementation-orchestrator/contracts";

export class InvalidCompiledTaskError extends Error {
  constructor(taskId: string, issues: string) {
    super(`Compiler produced an invalid task "${taskId}": ${issues}`);
    this.name = "InvalidCompiledTaskError";
  }
}

export function normalizeTask(task: ExecutableTask): ExecutableTask {
  const parsed = ExecutableTaskSchema.safeParse(task);
  if (!parsed.success) {
    throw new InvalidCompiledTaskError(task.id, parsed.error.issues.map((i) => i.message).join("; "));
  }
  return parsed.data;
}
