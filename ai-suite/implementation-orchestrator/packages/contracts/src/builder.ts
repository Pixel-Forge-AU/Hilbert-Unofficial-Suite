import { z } from "zod";
import { ExecutableTaskSchema } from "./task.js";
import { RepositoryProfileSchema } from "./repository.js";

export const BuilderHealthSchema = z.object({
  healthy: z.boolean(),
  details: z.string().optional(),
});
export type BuilderHealth = z.infer<typeof BuilderHealthSchema>;

export const BuilderSessionRequestSchema = z.object({
  workflowId: z.string(),
  workspacePath: z.string(),
  builderProfile: z.string(),
});
export type BuilderSessionRequest = z.infer<typeof BuilderSessionRequestSchema>;

export const BuilderSessionSchema = z.object({
  id: z.string(),
  builderProfile: z.string(),
  createdAt: z.string(),
});
export type BuilderSession = z.infer<typeof BuilderSessionSchema>;

export const BuilderAttemptSummarySchema = z.object({
  attemptNumber: z.number().int().positive(),
  status: z.string(),
  summary: z.string().optional(),
});
export type BuilderAttemptSummary = z.infer<typeof BuilderAttemptSummarySchema>;

export const RemediationInstructionSchema = z.object({
  taskId: z.string(),
  attempt: z.number().int().positive(),
  failureClass: z.string(),
  failedChecks: z.array(
    z.object({
      name: z.string(),
      exitCode: z.number().int().nullable().optional(),
      summary: z.string(),
    }),
  ),
  instruction: z.string(),
});
export type RemediationInstruction = z.infer<typeof RemediationInstructionSchema>;

export const BuilderCommandRecordSchema = z.object({
  command: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  truncated: z.boolean().default(false),
});
export type BuilderCommandRecord = z.infer<typeof BuilderCommandRecordSchema>;

export const BuilderReportedTestSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type BuilderReportedTest = z.infer<typeof BuilderReportedTestSchema>;

export const BuilderFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type BuilderFailure = z.infer<typeof BuilderFailureSchema>;

export const BuilderResultStatusSchema = z.enum(["completed", "failed", "cancelled", "timed_out"]);
export type BuilderResultStatus = z.infer<typeof BuilderResultStatusSchema>;

export const BuilderResultSchema = z.object({
  status: BuilderResultStatusSchema,
  summary: z.string(),
  changedFiles: z.array(z.string()),
  createdFiles: z.array(z.string()),
  deletedFiles: z.array(z.string()),
  commandsRun: z.array(BuilderCommandRecordSchema),
  commitSha: z.string().optional(),
  patchArtifactId: z.string().optional(),
  transcriptArtifactId: z.string().optional(),
  reportedTests: z.array(BuilderReportedTestSchema),
  warnings: z.array(z.string()),
  failure: BuilderFailureSchema.optional(),
});
export type BuilderResult = z.infer<typeof BuilderResultSchema>;

export const BuilderExecutionStatusSchema = z.object({
  state: z.enum(["queued", "running", "completed", "failed", "cancelled", "timed_out"]),
  lastHeartbeatAt: z.string().optional(),
});
export type BuilderExecutionStatus = z.infer<typeof BuilderExecutionStatusSchema>;

export const BuilderExecutionHandleSchema = z.object({
  builderId: z.string(),
  sessionId: z.string(),
  executionId: z.string(),
});
export type BuilderExecutionHandle = z.infer<typeof BuilderExecutionHandleSchema>;

export const BuilderTaskRequestSchema = z.object({
  workflowId: z.string(),
  task: ExecutableTaskSchema,
  workspacePath: z.string(),
  repositoryProfile: RepositoryProfileSchema,
  previousAttempts: z.array(BuilderAttemptSummarySchema),
  remediationInstructions: z.array(RemediationInstructionSchema).optional(),
});
export type BuilderTaskRequest = z.infer<typeof BuilderTaskRequestSchema>;
