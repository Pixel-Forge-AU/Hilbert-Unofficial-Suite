import { z } from "zod";

/** Non-empty trimmed string — the default building block for all planning text. */
export const text = z.string().trim().min(1);

export const textList = z.array(text);

export const severitySchema = z.enum(["low", "medium", "high", "blocking"]);

export const complexitySchema = z.enum(["low", "medium", "high", "extreme"]);

export const assumptionSchema = z.object({
  id: text,
  statement: text,
  basis: text,
  confidence: z.enum(["low", "medium", "high"]),
  impactIfWrong: text
});
export type Assumption = z.infer<typeof assumptionSchema>;

export const planningQuestionSchema = z.object({
  question: text,
  whyItMatters: text,
  assumedAnswer: text,
  blocking: z.boolean().default(false)
});
export type PlanningQuestion = z.infer<typeof planningQuestionSchema>;

export const userProfileSchema = z.object({
  id: text,
  name: text,
  description: text,
  goals: textList,
  frustrations: textList.default([]),
  technicalConfidence: z.enum(["low", "medium", "high"]).default("medium"),
  primaryDevice: text.default("desktop and mobile"),
  accessibilityNeeds: textList.default([])
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const PLANNER_STAGE_NAMES = [
  "intent_interpreter",
  "concept_generator",
  "creative_director",
  "feature_expander",
  "ux_designer",
  "art_director",
  "systems_architect",
  "edge_case_hunter",
  "scope_challenger",
  "specification_compiler",
  "plan_critic",
  "plan_gate"
] as const;

export const plannerStageNameSchema = z.enum(PLANNER_STAGE_NAMES);
export type PlannerStageName = z.infer<typeof plannerStageNameSchema>;

export const PLAN_STATUSES = [
  "queued",
  "running",
  "awaiting_revision",
  "passed",
  "failed",
  "cancelled",
  "paused"
] as const;
export const planStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const STAGE_EXECUTION_STATUSES = [
  "pending",
  "running",
  "completed",
  "invalid_output",
  "failed",
  "superseded"
] as const;
export const stageExecutionStatusSchema = z.enum(STAGE_EXECUTION_STATUSES);
export type StageExecutionStatus = z.infer<typeof stageExecutionStatusSchema>;

export const stageSummarySchema = z.object({
  stage: plannerStageNameSchema,
  headline: text,
  keyPoints: textList,
  itemCounts: z.record(z.number()).default({})
});
export type StageSummary = z.infer<typeof stageSummarySchema>;
