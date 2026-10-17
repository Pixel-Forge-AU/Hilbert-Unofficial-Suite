import { z } from "zod";
import { plannerStageNameSchema, text } from "./common.js";

export const planGateSeveritySchema = z.enum(["notice", "warning", "error"]);
export type PlanGateSeverity = z.infer<typeof planGateSeveritySchema>;

export const planGateDecisionSchema = z.enum(["passed", "passed_with_warnings", "rejected"]);
export type PlanGateDecision = z.infer<typeof planGateDecisionSchema>;

export const unresolvedDecisionImpactSchema = z.enum([
  "informational",
  "task_local",
  "phase_blocking",
  "implementation_blocking"
]);
export type UnresolvedDecisionImpact = z.infer<typeof unresolvedDecisionImpactSchema>;

export const planGateAdjudicationOutcomeSchema = z.enum(["confirmed", "dismissed"]);
export type PlanGateAdjudicationOutcome = z.infer<typeof planGateAdjudicationOutcomeSchema>;

export const planGateFindingSchema = z.object({
  id: text,
  ruleId: text,
  severity: planGateSeveritySchema,
  sectionPath: text,
  problem: text,
  evidence: text,
  requiredChange: text,
  responsibleStage: plannerStageNameSchema,
  requiresAdjudication: z.boolean().default(false),
  adjudicationOutcome: planGateAdjudicationOutcomeSchema.nullable().default(null),
  adjudicationRationale: text.nullable().default(null)
});
export type PlanGateFinding = z.infer<typeof planGateFindingSchema>;

export const planGateCoverageSchema = z.object({
  essentialFeaturesWithAcceptanceCriteria: z.number().min(0).max(1),
  essentialFeaturesWithTestScenarios: z.number().min(0).max(1),
  requirementsWithTraceability: z.number().min(0).max(1),
  featuresAssignedToImplementationPhase: z.number().min(0).max(1)
});
export type PlanGateCoverage = z.infer<typeof planGateCoverageSchema>;

export const planGateResultSchema = z
  .object({
    decision: planGateDecisionSchema,
    findings: z.array(planGateFindingSchema),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    noticeCount: z.number().int().min(0),
    coverage: planGateCoverageSchema,
    adjudicationUsed: z.boolean(),
    summary: text
  })
  .superRefine((result, ctx) => {
    const active = (severity: PlanGateSeverity) =>
      result.findings.filter((finding) => finding.severity === severity && finding.adjudicationOutcome !== "dismissed")
        .length;
    if (result.errorCount !== active("error")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCount"],
        message: "errorCount does not match active error findings."
      });
    }
    if (result.warningCount !== active("warning")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["warningCount"],
        message: "warningCount does not match active warning findings."
      });
    }
    if (result.noticeCount !== active("notice")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noticeCount"],
        message: "noticeCount does not match active notice findings."
      });
    }
    if (result.decision === "rejected" && active("error") === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message: "decision is rejected but no active error findings exist."
      });
    }
    if (result.decision !== "rejected" && active("error") > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message: "Active error findings exist but decision is not rejected."
      });
    }
  });
export type PlanGateResult = z.infer<typeof planGateResultSchema>;

// --- Adjudicator LLM call shape ------------------------------------------

export const planGateAdjudicationResultSchema = z.object({
  findingId: text,
  outcome: planGateAdjudicationOutcomeSchema,
  rationale: text
});
export type PlanGateAdjudicationResult = z.infer<typeof planGateAdjudicationResultSchema>;

export const planGateAdjudicationBatchSchema = z.object({
  adjudications: z.array(planGateAdjudicationResultSchema).min(1)
});
export type PlanGateAdjudicationBatch = z.infer<typeof planGateAdjudicationBatchSchema>;
