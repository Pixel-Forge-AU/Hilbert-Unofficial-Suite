import type { BuildManifest, PlanGateFinding, PlannerStageName } from "@planner/contracts";
import { attemptAutoRepair } from "./auto-repair.js";
import { ReferenceIndex } from "./reference-index.js";
import { PLAN_GATE_RULES } from "./rules/index.js";
import type { PlanGateRuleContext } from "./types.js";
import { classifyUnresolvedDecision } from "./unresolved-decision-classifier.js";

/**
 * Runs whichever plan_gate rules just became checkable now that `stageName` has completed
 * (see each rule's earliestStage), against a partial manifest built from outputs so far - this
 * is what lets structural defects (dangling references, cycles) get caught the moment the
 * stage that could introduce them finishes, instead of only at the very end when the full
 * manifest and plan_critic output both exist.
 *
 * Findings that attemptAutoRepair can fix for free (the same pass plan_gate already applies at
 * the end of the pipeline) are filtered out here too - there's no value in forcing an early
 * regeneration for something that's going to be silently repaired anyway at zero LLM cost.
 */
export function evaluateEarlyPlanGateChecks(stageName: PlannerStageName, manifest: BuildManifest): PlanGateFinding[] {
  const rules = PLAN_GATE_RULES.filter((rule) => rule.earliestStage === stageName);
  if (rules.length === 0) return [];

  const referenceIndex = new ReferenceIndex(manifest);
  const unresolvedDecisionClassifications = new Map(
    manifest.unresolvedDecisions.map((decision) => [decision.id, classifyUnresolvedDecision(decision)])
  );
  const context: PlanGateRuleContext = { manifest, referenceIndex, unresolvedDecisionClassifications };
  const findings = rules.flatMap((rule) => rule.evaluate(context));
  if (findings.length === 0) return [];

  const { repairedFindingIds } = attemptAutoRepair(manifest, findings);
  const repaired = new Set(repairedFindingIds);
  return findings.filter((finding) => !repaired.has(finding.id));
}

/**
 * Of the findings evaluateEarlyPlanGateChecks returns, only these are eligible for an
 * immediate same-stage retry: real errors (not warnings/notices) whose responsibleStage is the
 * stage that just ran. A rule can become checkable at one stage's checkpoint (earliestStage)
 * while blaming an earlier stage for the actual defect (e.g. unresolved-decision-impact can
 * blame systems_architect from the specification_compiler checkpoint) - those still get
 * recorded and will be caught by the final plan_gate as before, just not retried in place,
 * since retrying `stageName` wouldn't touch the section that's actually wrong.
 */
export function findingsEligibleForImmediateRetry(
  findings: PlanGateFinding[],
  stageName: PlannerStageName
): PlanGateFinding[] {
  return findings.filter((finding) => finding.severity === "error" && finding.responsibleStage === stageName);
}
