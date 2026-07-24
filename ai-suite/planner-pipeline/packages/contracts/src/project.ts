import { z } from "zod";
import { text, textList } from "./common.js";

export const planPreferencesSchema = z.object({
  strictness: z.number().int().min(1).max(10).default(9),
  creativity: z.number().int().min(1).max(10).default(9),
  detailLevel: z.number().int().min(1).max(10).default(10),
  targetQualityScore: z.number().min(0).max(100).default(92),
  maxRevisionCycles: z.number().int().min(0).max(20).default(4)
});
export type PlanPreferences = z.infer<typeof planPreferencesSchema>;

export const planContextSchema = z.object({
  existingStack: textList.default([]),
  existingSystems: textList.default([]),
  referenceNotes: textList.default([])
});
export type PlanContext = z.infer<typeof planContextSchema>;

export const implementationTargetSchema = z.object({
  repository: z.object({
    url: text,
    baseBranch: text,
    credentialReference: text.optional()
  }),
  policyProfile: text.default("default-safe"),
  builderProfile: text.default("mock")
});
export type ImplementationTarget = z.infer<typeof implementationTargetSchema>;

export const createPlanRequestSchema = z.object({
  title: text.max(200),
  brief: text.max(20_000),
  constraints: textList.default([]),
  preferences: planPreferencesSchema.default({}),
  context: planContextSchema.default({}),
  implementationTarget: implementationTargetSchema.optional()
});
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;

export const projectDefinitionSchema = z.object({
  title: text,
  brief: text,
  constraints: textList,
  context: planContextSchema,
  preferences: planPreferencesSchema
});
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;
