import { z } from "zod";
import type { PlannerStageName } from "./common.js";
import { planCritiqueSchema } from "./critic.js";
import { compilerSynthesisSchema } from "./manifest.js";
import { planGateResultSchema } from "./plan-gate.js";
import {
  architecturePlanSchema,
  conceptGenerationSchema,
  creativeDirectionSchema,
  edgeCaseReportSchema,
  featureExpansionSchema,
  intentInterpretationSchema,
  scopePlanSchema,
  uxJourneyPlanSchema,
  visualDirectionSchema
} from "./stages.js";

export const stageOutputSchemas = {
  intent_interpreter: intentInterpretationSchema,
  concept_generator: conceptGenerationSchema,
  creative_director: creativeDirectionSchema,
  feature_expander: featureExpansionSchema,
  ux_designer: uxJourneyPlanSchema,
  art_director: visualDirectionSchema,
  systems_architect: architecturePlanSchema,
  edge_case_hunter: edgeCaseReportSchema,
  scope_challenger: scopePlanSchema,
  specification_compiler: compilerSynthesisSchema,
  plan_critic: planCritiqueSchema,
  plan_gate: planGateResultSchema
} satisfies Record<PlannerStageName, z.ZodTypeAny>;

export type StageOutputByName = {
  [K in keyof typeof stageOutputSchemas]: z.infer<(typeof stageOutputSchemas)[K]>;
};

/**
 * Patch mode needs an "everything optional" version of a stage's full schema. Most stage
 * schemas are a plain ZodObject, but some (e.g. edgeCaseReportSchema) are wrapped in
 * `.superRefine()`, which produces a ZodEffects - ZodEffects has no `.partial()`. The
 * refinement itself doesn't apply to an intentionally-partial patch anyway (it validates
 * relationships - e.g. per-category counts - across the whole object, which a patch by
 * definition doesn't have), so this unwraps down to the underlying object before calling
 * `.partial()` on that instead of on the wrapper.
 */
export function toPartialStageSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current.innerType();
  }
  if (!(current instanceof z.ZodObject)) {
    throw new Error("Cannot derive a partial schema from a non-object stage schema.");
  }
  return current.partial();
}
