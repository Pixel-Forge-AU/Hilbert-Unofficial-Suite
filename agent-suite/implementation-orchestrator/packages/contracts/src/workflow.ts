import { z } from "zod";

export const WorkflowStatusSchema = z.enum([
  "created",
  "validating_manifest",
  "inspecting_repository",
  "compiling_tasks",
  "validating_task_graph",
  "preparing_workspace",
  "running",
  "verifying",
  "remediating",
  "release_gate",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WORKFLOW_TERMINAL_STATUSES: readonly WorkflowStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalWorkflowStatus(status: WorkflowStatus): boolean {
  return WORKFLOW_TERMINAL_STATUSES.includes(status);
}

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  created: ["validating_manifest", "failed", "cancelled"],
  validating_manifest: ["inspecting_repository", "failed", "cancelled"],
  inspecting_repository: ["compiling_tasks", "failed", "cancelled"],
  compiling_tasks: ["validating_task_graph", "failed", "cancelled"],
  validating_task_graph: ["preparing_workspace", "failed", "cancelled"],
  preparing_workspace: ["running", "failed", "cancelled"],
  running: ["verifying", "remediating", "completed", "failed", "cancelled"],
  verifying: ["running", "remediating", "release_gate", "completed", "failed", "cancelled"],
  remediating: ["running", "failed", "cancelled"],
  release_gate: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isValidWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

export const RepositoryConfigSchema = z.object({
  url: z.string().min(1),
  baseBranch: z.string().min(1),
  credentialReference: z.string().min(1).optional(),
});
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;

export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(1),
  manifest: z.record(z.unknown()),
  repository: RepositoryConfigSchema,
  policyProfile: z.string().min(1),
  builderProfile: z.string().min(1),
});
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const CreateWorkflowResponseSchema = z.object({
  workflowId: z.string(),
  status: WorkflowStatusSchema,
});
export type CreateWorkflowResponse = z.infer<typeof CreateWorkflowResponseSchema>;

export const WorkflowTaskTotalsSchema = z.record(z.string(), z.number().int().nonnegative());
export type WorkflowTaskTotals = z.infer<typeof WorkflowTaskTotalsSchema>;

export const WorkflowCompletionSummarySchema = z.object({
  workflowId: z.string(),
  status: z.literal("completed"),
  manifestHash: z.string(),
  baseCommitSha: z.string(),
  finalCommitSha: z.string(),
  acceptedTasks: z.number().int().nonnegative(),
  skippedOptionalTasks: z.number().int().nonnegative(),
  failedOptionalTasks: z.number().int().nonnegative(),
  artifactIds: z.array(z.string()),
  completedAt: z.string(),
});
export type WorkflowCompletionSummary = z.infer<typeof WorkflowCompletionSummarySchema>;

export const WorkflowFailureSchema = z.object({
  workflowId: z.string(),
  status: z.literal("failed"),
  failureCode: z.string(),
  failureClass: z.string(),
  stage: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  evidence: z.record(z.unknown()).optional(),
  lastSuccessfulState: z.string().nullable().optional(),
  suggestedOperatorAction: z.string().nullable().optional(),
  failedAt: z.string(),
});
export type WorkflowFailure = z.infer<typeof WorkflowFailureSchema>;

export const WorkflowSummarySchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  status: WorkflowStatusSchema,
  manifestHash: z.string().optional(),
  baseCommitSha: z.string().nullable().optional(),
  taskTotals: WorkflowTaskTotalsSchema,
  activeLeases: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  latestErrors: z.array(z.string()),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  completionSummary: WorkflowCompletionSummarySchema.optional(),
  failureDetails: WorkflowFailureSchema.optional(),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;
