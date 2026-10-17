// Mirrored from planner-pipeline packages/contracts/src/plan-gate.ts — keep in sync manually.
// This is the structured output of planner-pipeline's Plan Gate stage, carried as a
// required field on the rich BuildManifest this orchestrator now ingests.
import { z } from "zod";

const text = z.string().trim().min(1);

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
export const PlannerStageNameSchema = z.enum(PLANNER_STAGE_NAMES);
export type PlannerStageName = z.infer<typeof PlannerStageNameSchema>;

export const PlanGateSeveritySchema = z.enum(["notice", "warning", "error"]);
export type PlanGateSeverity = z.infer<typeof PlanGateSeveritySchema>;

export const PlanGateDecisionSchema = z.enum(["passed", "passed_with_warnings", "rejected"]);
export type PlanGateDecision = z.infer<typeof PlanGateDecisionSchema>;

export const PlanGateAdjudicationOutcomeSchema = z.enum(["confirmed", "dismissed"]);
export type PlanGateAdjudicationOutcome = z.infer<typeof PlanGateAdjudicationOutcomeSchema>;

export const PlanGateFindingSchema = z.object({
  id: text,
  ruleId: text,
  severity: PlanGateSeveritySchema,
  sectionPath: text,
  problem: text,
  evidence: text,
  requiredChange: text,
  responsibleStage: PlannerStageNameSchema,
  requiresAdjudication: z.boolean().default(false),
  adjudicationOutcome: PlanGateAdjudicationOutcomeSchema.nullable().default(null),
  adjudicationRationale: text.nullable().default(null)
});
export type PlanGateFinding = z.infer<typeof PlanGateFindingSchema>;

export const PlanGateCoverageSchema = z.object({
  essentialFeaturesWithAcceptanceCriteria: z.number().min(0).max(1),
  essentialFeaturesWithTestScenarios: z.number().min(0).max(1),
  requirementsWithTraceability: z.number().min(0).max(1),
  featuresAssignedToImplementationPhase: z.number().min(0).max(1)
});
export type PlanGateCoverage = z.infer<typeof PlanGateCoverageSchema>;

export const PlanGateResultSchema = z
  .object({
    decision: PlanGateDecisionSchema,
    findings: z.array(PlanGateFindingSchema),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    noticeCount: z.number().int().min(0),
    coverage: PlanGateCoverageSchema,
    adjudicationUsed: z.boolean(),
    summary: text
  })
  .superRefine((result, ctx) => {
    const active = (severity: PlanGateSeverity) =>
      result.findings.filter((finding) => finding.severity === severity && finding.adjudicationOutcome !== "dismissed")
        .length;
    if (result.errorCount !== active("error")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCount"], message: "errorCount does not match active error findings." });
    }
    if (result.warningCount !== active("warning")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warningCount"], message: "warningCount does not match active warning findings." });
    }
    if (result.noticeCount !== active("notice")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["noticeCount"], message: "noticeCount does not match active notice findings." });
    }
    if (result.decision === "rejected" && active("error") === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "decision is rejected but no active error findings exist." });
    }
    if (result.decision !== "rejected" && active("error") > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "Active error findings exist but decision is not rejected." });
    }
  });
export type PlanGateResult = z.infer<typeof PlanGateResultSchema>;
