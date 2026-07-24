import type { BuildManifest, PlanCritique, PlanGateCoverage, PlanGateFinding } from "@planner/contracts";
import { computeCoverage } from "./coverage.js";
import { ReferenceIndex } from "./reference-index.js";
import { PLAN_GATE_RULES } from "./rules/index.js";
import type { PlanGateRuleContext } from "./types.js";
import { classifyUnresolvedDecision } from "./unresolved-decision-classifier.js";

export function evaluatePlanGate(
  manifest: BuildManifest,
  critique: PlanCritique
): { findings: PlanGateFinding[]; coverage: PlanGateCoverage } {
  const referenceIndex = new ReferenceIndex(manifest);
  const unresolvedDecisionClassifications = new Map(
    manifest.unresolvedDecisions.map((decision) => [decision.id, classifyUnresolvedDecision(decision)])
  );
  const context: PlanGateRuleContext = {
    manifest,
    critique,
    referenceIndex,
    unresolvedDecisionClassifications
  };
  const findings = PLAN_GATE_RULES.flatMap((rule) => rule.evaluate(context));
  const coverage = computeCoverage(manifest);
  return { findings, coverage };
}
