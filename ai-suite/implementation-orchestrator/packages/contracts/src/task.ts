import { z } from "zod";
import { TaskExecutionPolicySchema } from "./policies.js";
import { TaskVerificationPlanSchema } from "./verification.js";

export const TaskStatusSchema = z.enum([
  "pending",
  "blocked",
  "ready",
  "leased",
  "running",
  "builder_completed",
  "verifying",
  "verification_failed",
  "remediation_required",
  "accepted",
  "retry_scheduled",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_TERMINAL_STATUSES: readonly TaskStatus[] = ["accepted", "failed", "cancelled"];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_TERMINAL_STATUSES.includes(status);
}

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["blocked", "ready", "cancelled"],
  blocked: ["ready", "cancelled"],
  ready: ["leased", "cancelled"],
  leased: ["running", "ready", "cancelled"],
  running: ["builder_completed", "retry_scheduled", "failed", "cancelled"],
  builder_completed: ["verifying", "cancelled"],
  verifying: ["accepted", "verification_failed", "cancelled"],
  verification_failed: ["remediation_required", "retry_scheduled", "failed", "cancelled"],
  remediation_required: ["ready", "failed", "cancelled"],
  retry_scheduled: ["ready", "failed", "cancelled"],
  accepted: [],
  failed: [],
  cancelled: [],
};

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const TaskCategorySchema = z.enum([
  "repository_setup",
  "dependency",
  "database",
  "backend",
  "api",
  "frontend",
  "integration",
  "testing",
  "documentation",
  "infrastructure",
  "migration",
  "verification",
  "remediation",
]);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export const TaskPrioritySchema = z.enum(["blocking", "essential", "high", "normal", "low"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = {
  blocking: 0,
  essential: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export const TaskScopeSchema = z.object({
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  likelyFiles: z.array(z.string()),
  allowedDirectories: z.array(z.string()),
  forbiddenDirectories: z.array(z.string()),
});
export type TaskScope = z.infer<typeof TaskScopeSchema>;

export const TaskRepositoryContextSchema = z.object({
  baseBranch: z.string(),
  workflowBranch: z.string(),
  baseCommitSha: z.string().optional(),
});
export type TaskRepositoryContext = z.infer<typeof TaskRepositoryContextSchema>;

export const TaskAcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  sourceAcceptanceCriteriaId: z.string().optional(),
});
export type TaskAcceptanceCriterion = z.infer<typeof TaskAcceptanceCriterionSchema>;

export const ExpectedArtifactSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true),
});
export type ExpectedArtifact = z.infer<typeof ExpectedArtifactSchema>;

export const ExecutableTaskSchema = z.object({
  id: z.string(),
  workflowId: z.string().optional(),
  sourceFeatureIds: z.array(z.string()),
  sourceRequirementIds: z.array(z.string()),
  sourceAcceptanceCriteriaIds: z.array(z.string()),
  sourceTestScenarioIds: z.array(z.string()),
  phaseId: z.string(),
  title: z.string(),
  objective: z.string(),
  category: TaskCategorySchema,
  priority: TaskPrioritySchema,
  builderProfile: z.string(),
  scope: TaskScopeSchema,
  repositoryContext: TaskRepositoryContextSchema,
  dependencies: z.array(z.string()),
  acceptanceCriteria: z.array(TaskAcceptanceCriterionSchema),
  verification: TaskVerificationPlanSchema,
  execution: TaskExecutionPolicySchema,
  policyConstraints: z.array(z.string()),
  expectedArtifacts: z.array(ExpectedArtifactSchema),
  tags: z.array(z.string()),
});
export type ExecutableTask = z.infer<typeof ExecutableTaskSchema>;

export const TaskDependencyTypeSchema = z.enum(["hard", "soft", "verification", "artifact"]);
export type TaskDependencyType = z.infer<typeof TaskDependencyTypeSchema>;

export const TaskDependencySchema = z.object({
  fromTaskId: z.string(),
  toTaskId: z.string(),
  type: TaskDependencyTypeSchema,
  reason: z.string(),
});
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export const TaskAttemptTypeSchema = z.enum(["initial", "retry", "remediation"]);
export type TaskAttemptType = z.infer<typeof TaskAttemptTypeSchema>;

export const FailureClassSchema = z.enum([
  "transient",
  "builder",
  "verification",
  "environment",
  "manifest",
  "policy",
  "internal",
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const TaskSummarySchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: TaskStatusSchema,
  phaseId: z.string(),
  title: z.string(),
  category: TaskCategorySchema,
  priority: TaskPrioritySchema,
  builderProfile: z.string(),
  dependencies: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  readyAt: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskFilterSchema = z.object({
  status: TaskStatusSchema.optional(),
  featureId: z.string().optional(),
  phaseId: z.string().optional(),
  builderProfile: z.string().optional(),
  priority: TaskPrioritySchema.optional(),
});
export type TaskFilter = z.infer<typeof TaskFilterSchema>;
