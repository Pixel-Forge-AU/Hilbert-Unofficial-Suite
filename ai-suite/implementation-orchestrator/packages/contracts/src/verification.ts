import { z } from "zod";
import { ArtifactReferenceSchema } from "./artifacts.js";

export const VerificationCheckTypeSchema = z.enum([
  "git_cleanliness",
  "changed_file_scope",
  "install",
  "build",
  "typecheck",
  "lint",
  "unit_test",
  "integration_test",
  "migration_check",
  "application_start",
  "smoke_test",
  "custom_command",
]);
export type VerificationCheckType = z.infer<typeof VerificationCheckTypeSchema>;

export const VerificationCheckDefinitionSchema = z.object({
  id: z.string(),
  type: VerificationCheckTypeSchema,
  name: z.string(),
  command: z.string().optional(),
  workingDirectory: z.string().optional(),
  timeoutSeconds: z.number().int().positive(),
  required: z.boolean(),
  continueOnFailure: z.boolean(),
  environmentReferences: z.array(z.string()),
  expectedExitCodes: z.array(z.number().int()),
});
export type VerificationCheckDefinition = z.infer<typeof VerificationCheckDefinitionSchema>;

export const VerificationPassPolicySchema = z.enum(["all_required", "all_checks"]);
export type VerificationPassPolicy = z.infer<typeof VerificationPassPolicySchema>;

export const TaskVerificationPlanSchema = z.object({
  checks: z.array(VerificationCheckDefinitionSchema),
  requiredArtifactTypes: z.array(z.string()),
  passPolicy: VerificationPassPolicySchema,
});
export type TaskVerificationPlan = z.infer<typeof TaskVerificationPlanSchema>;

export const VerificationCheckResultSchema = z.object({
  checkId: z.string(),
  type: VerificationCheckTypeSchema,
  name: z.string(),
  passed: z.boolean(),
  required: z.boolean(),
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().int().nonnegative(),
  summary: z.string().optional(),
  stdoutArtifactId: z.string().optional(),
  stderrArtifactId: z.string().optional(),
});
export type VerificationCheckResult = z.infer<typeof VerificationCheckResultSchema>;

export const VerificationArtifactReferenceSchema = ArtifactReferenceSchema;
export type VerificationArtifactReference = z.infer<typeof VerificationArtifactReferenceSchema>;

export const VerificationResultSchema = z.object({
  taskId: z.string(),
  attemptId: z.string(),
  passed: z.boolean(),
  checks: z.array(VerificationCheckResultSchema),
  artifacts: z.array(VerificationArtifactReferenceSchema),
  startedAt: z.string(),
  completedAt: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const VerificationSummarySchema = z.object({
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  failedChecks: z.number().int().nonnegative(),
  requiredChecksFailed: z.number().int().nonnegative(),
});
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;
