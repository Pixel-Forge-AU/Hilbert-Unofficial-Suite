import type { PlanGateFinding, PlanGateSeverity, PlannerStageName, UnresolvedDecisionImpact } from "@planner/contracts";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

const SEVERITY_BY_IMPACT: Record<UnresolvedDecisionImpact, PlanGateSeverity> = {
  implementation_blocking: "error",
  phase_blocking: "warning",
  task_local: "notice",
  informational: "notice"
};

const RESPONSIBLE_STAGE_BY_IMPACT: Record<UnresolvedDecisionImpact, PlannerStageName> = {
  implementation_blocking: "systems_architect",
  phase_blocking: "scope_challenger",
  task_local: "specification_compiler",
  informational: "specification_compiler"
};

const unresolvedDecisionImpact: PlanGateRule = {
  id: "unresolved-decision-impact",
  description: "Every unresolved decision is classified by implementation impact; implementation-blocking decisions are not safe to defer.",
  defaultSeverity: "warning",
  earliestStage: "specification_compiler",
  evaluate({ manifest, unresolvedDecisionClassifications }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const decision of manifest.unresolvedDecisions) {
      const classification = unresolvedDecisionClassifications.get(decision.id);
      if (!classification) continue;
      const severity = SEVERITY_BY_IMPACT[classification.impact];
      if (severity === "notice" && !classification.ambiguous) continue;
      findings.push(
        createFinding({
          ruleId: unresolvedDecisionImpact.id,
          discriminator: decision.id,
          severity,
          sectionPath: `unresolvedDecisions.${decision.id}`,
          problem: `Unresolved decision "${decision.decision}" is classified ${classification.impact}.`,
          evidence:
            classification.matchedKeywords.length > 0
              ? `Matched signal(s): ${classification.matchedKeywords.join(", ")}.`
              : "No classification keyword matched; defaulted to task_local.",
          requiredChange:
            classification.impact === "implementation_blocking"
              ? `Resolve "${decision.decision}" before implementation begins: ${decision.recommendation}`
              : `Confirm "${decision.decision}" can be deferred as ${classification.impact}, or resolve it now.`,
          responsibleStage: RESPONSIBLE_STAGE_BY_IMPACT[classification.impact],
          requiresAdjudication: classification.ambiguous
        })
      );
    }
    return findings;
  }
};

export const unresolvedDecisionRules: PlanGateRule[] = [unresolvedDecisionImpact];
