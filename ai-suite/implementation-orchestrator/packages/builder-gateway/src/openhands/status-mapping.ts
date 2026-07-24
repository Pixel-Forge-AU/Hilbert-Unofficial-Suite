import type { BuilderExecutionStatus } from "@implementation-orchestrator/contracts";

export type ConversationExecutionStatus =
  | "idle"
  | "running"
  | "paused"
  | "waiting_for_confirmation"
  | "finished"
  | "error"
  | "stuck"
  | "deleting";

export function mapExecutionStatus(status: ConversationExecutionStatus): BuilderExecutionStatus["state"] {
  switch (status) {
    case "idle":
      return "queued";
    case "running":
    case "paused":
    case "waiting_for_confirmation":
      return "running";
    case "finished":
      return "completed";
    case "error":
    case "stuck":
      return "failed";
    case "deleting":
      return "cancelled";
    default:
      return "failed";
  }
}
