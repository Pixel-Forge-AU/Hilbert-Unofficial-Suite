// The narrow, flat manifest shape actually consumed by @implementation-orchestrator/task-compiler.
// This used to be the wire-facing BuildManifest; it is now an internal projection produced by
// deriveCompilationManifest() (packages/orchestrator-core/src/manifest-projection.ts) from the
// rich BuildManifest defined in ./manifest.ts. Field shapes are unchanged from before that split.
import { z } from "zod";

export const CompilationFeaturePrioritySchema = z.enum(["essential", "high_value", "optional"]);
export type CompilationFeaturePriority = z.infer<typeof CompilationFeaturePrioritySchema>;

export const CompilationAcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
});
export type CompilationAcceptanceCriterion = z.infer<typeof CompilationAcceptanceCriterionSchema>;

export const CompilationTestScenarioSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
});
export type CompilationTestScenario = z.infer<typeof CompilationTestScenarioSchema>;

export const CompilationFeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priority: CompilationFeaturePrioritySchema,
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(CompilationAcceptanceCriterionSchema).default([]),
  testScenarios: z.array(CompilationTestScenarioSchema).default([]),
});
export type CompilationFeature = z.infer<typeof CompilationFeatureSchema>;

export const CompilationPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
  featureIds: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});
export type CompilationPhase = z.infer<typeof CompilationPhaseSchema>;

export const CompilationManifestSchema = z.object({
  manifestId: z.string().min(1),
  manifestVersion: z.string().min(1),
  name: z.string().min(1),
  features: z.array(CompilationFeatureSchema).min(1),
  phases: z.array(CompilationPhaseSchema).min(1),
});
export type CompilationManifest = z.infer<typeof CompilationManifestSchema>;
