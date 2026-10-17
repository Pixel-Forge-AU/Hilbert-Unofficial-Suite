import type {
  BuilderExecutionHandle,
  BuilderExecutionStatus,
  BuilderHealth,
  BuilderResult,
  BuilderSession,
  BuilderSessionRequest,
  BuilderTaskRequest,
} from "@implementation-orchestrator/contracts";

export interface BuilderAdapter {
  readonly id: string;

  healthCheck(): Promise<BuilderHealth>;

  createSession(request: BuilderSessionRequest): Promise<BuilderSession>;

  executeTask(session: BuilderSession, task: BuilderTaskRequest): Promise<BuilderExecutionHandle>;

  getStatus(handle: BuilderExecutionHandle): Promise<BuilderExecutionStatus>;

  cancel(handle: BuilderExecutionHandle): Promise<void>;

  collectResult(handle: BuilderExecutionHandle): Promise<BuilderResult>;
}

export const TERMINAL_EXECUTION_STATES: readonly BuilderExecutionStatus["state"][] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];

export function isTerminalExecutionState(state: BuilderExecutionStatus["state"]): boolean {
  return TERMINAL_EXECUTION_STATES.includes(state);
}
