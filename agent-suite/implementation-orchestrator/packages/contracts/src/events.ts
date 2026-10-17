import { z } from "zod";

export const WorkflowEventTypeSchema = z.enum([
  "workflow.created",
  "workflow.manifest_validated",
  "workflow.repository_inspection_started",
  "workflow.repository_inspection_completed",
  "workflow.task_compilation_started",
  "workflow.task_compilation_completed",
  "workflow.task_graph_validated",
  "workflow.workspace_created",
  "workflow.running",
  "workflow.completed",
  "workflow.failed",
  "workflow.cancelled",

  "task.created",
  "task.blocked",
  "task.ready",
  "task.leased",
  "task.started",
  "task.heartbeat",
  "task.builder_completed",
  "task.builder_failed",
  "task.verification_started",
  "task.verification_completed",
  "task.verification_failed",
  "task.retry_scheduled",
  "task.accepted",
  "task.failed",
  "task.cancelled",

  "lease.acquired",
  "lease.heartbeat",
  "lease.expired",
  "lease.released",

  "artifact.created",
  "policy.violation",
]);
export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>;

export const WorkflowEventSchema = z.object({
  id: z.string(),
  type: WorkflowEventTypeSchema,
  workflowId: z.string(),
  taskId: z.string().optional(),
  attemptId: z.string().optional(),
  occurredAt: z.string(),
  source: z.string(),
  payload: z.unknown(),
});
export type WorkflowEvent<TPayload = unknown> = Omit<z.infer<typeof WorkflowEventSchema>, "payload"> & {
  payload: TPayload;
};

export const CreateEventRequestSchema = z.object({
  id: z.string().min(1),
  type: WorkflowEventTypeSchema,
  workflowId: z.string().min(1),
  taskId: z.string().optional(),
  attemptId: z.string().optional(),
  occurredAt: z.string().optional(),
  source: z.string().min(1),
  payload: z.unknown().optional(),
});
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;
