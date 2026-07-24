import { z } from "zod";
import {
  planStatusSchema,
  plannerStageNameSchema,
  stageExecutionStatusSchema,
  text,
  textList
} from "./common.js";
import { buildManifestSchema } from "./manifest.js";

export const createPlanResponseSchema = z.object({
  planId: text,
  status: z.literal("queued")
});
export type CreatePlanResponse = z.infer<typeof createPlanResponseSchema>;

export const planStatusResponseSchema = z.object({
  planId: text,
  title: text,
  status: planStatusSchema,
  currentStage: plannerStageNameSchema.nullable(),
  progressPercentage: z.number().min(0).max(100),
  completedStages: z.array(plannerStageNameSchema),
  latestQualityScore: z.number().min(0).max(100).nullable(),
  revisionCycle: z.number().int().min(0),
  maxRevisionCycles: z.number().int().min(0),
  createdAt: text,
  updatedAt: text,
  completedAt: text.nullable(),
  failure: z
    .object({
      code: text.nullable(),
      message: text.nullable()
    })
    .nullable()
});
export type PlanStatusResponse = z.infer<typeof planStatusResponseSchema>;

export const stageOutputResponseSchema = z.object({
  planId: text,
  stageName: plannerStageNameSchema,
  status: stageExecutionStatusSchema,
  attempt: z.number().int().min(1),
  output: z.unknown().nullable(),
  summary: z.unknown().nullable(),
  completedAt: text.nullable()
});
export type StageOutputResponse = z.infer<typeof stageOutputResponseSchema>;

export const addPlanInstructionRequestSchema = z.object({
  instruction: text.max(10_000),
  rerunFromStage: plannerStageNameSchema
});
export type AddPlanInstructionRequest = z.infer<typeof addPlanInstructionRequestSchema>;

export const addPlanInstructionResponseSchema = z.object({
  planId: text,
  status: z.literal("awaiting_revision"),
  rerunFromStage: plannerStageNameSchema
});
export type AddPlanInstructionResponse = z.infer<typeof addPlanInstructionResponseSchema>;

export const cancelPlanResponseSchema = z.object({
  planId: text,
  status: z.literal("cancelled")
});
export type CancelPlanResponse = z.infer<typeof cancelPlanResponseSchema>;

export const retryPlanResponseSchema = z.object({
  planId: text,
  status: z.literal("queued")
});
export type RetryPlanResponse = z.infer<typeof retryPlanResponseSchema>;

export const pausePlanResponseSchema = z.object({
  planId: text,
  status: z.literal("paused")
});
export type PausePlanResponse = z.infer<typeof pausePlanResponseSchema>;

export const resumePlanResponseSchema = z.object({
  planId: text,
  status: z.literal("queued")
});
export type ResumePlanResponse = z.infer<typeof resumePlanResponseSchema>;

export const manifestResponseSchema = buildManifestSchema;

export const planListResponseSchema = z.object({
  plans: z.array(planStatusResponseSchema),
  nextCursor: text.nullable()
});
export type PlanListResponse = z.infer<typeof planListResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: text,
    message: text,
    details: z.unknown().optional()
  })
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const manifestFormatSchema = z.enum(["json", "yaml", "markdown"]);
export type ManifestFormat = z.infer<typeof manifestFormatSchema>;

export const planArtifactTypeSchema = z.enum([
  "manifest_json",
  "manifest_yaml",
  "manifest_markdown",
  "executive_summary",
  "critic_report",
  "stage_summary"
]);
export type PlanArtifactType = z.infer<typeof planArtifactTypeSchema>;

export const completedStageNamesSchema = z.object({
  completedStages: z.array(plannerStageNameSchema),
  allStages: z.array(plannerStageNameSchema),
  missingStages: textList
});
export type CompletedStageNames = z.infer<typeof completedStageNamesSchema>;
