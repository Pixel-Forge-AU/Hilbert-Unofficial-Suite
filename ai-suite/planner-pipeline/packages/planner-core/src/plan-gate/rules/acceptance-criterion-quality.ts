import type { PlanGateFinding } from "@planner/contracts";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

const SUBJECTIVE_TERMS = [
  "easy",
  "intuitive",
  "modern",
  "good",
  "fast",
  "clean",
  "seamless",
  "user-friendly",
  "robust",
  "efficient"
];

const MEASUREMENT_KEYWORDS = ["test", "audit", "p95", "p99"];

function hasConcreteMeasurement(measurement: string): boolean {
  const lower = measurement.toLowerCase();
  if (/\d/.test(measurement)) return true;
  if (measurement.includes("%")) return true;
  if (lower.includes("ms")) return true;
  return MEASUREMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

const acSubjectiveLanguageWithoutMeasurement: PlanGateRule = {
  id: "ac-subjective-language-without-measurement",
  description: "Acceptance criteria using subjective language must pair it with a concrete measurement.",
  defaultSeverity: "warning",
  earliestStage: "feature_expander",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const feature of manifest.features) {
      for (const criterion of feature.acceptanceCriteria) {
        const lowerCriterion = criterion.criterion.toLowerCase();
        const matched = SUBJECTIVE_TERMS.filter((term) => lowerCriterion.includes(term));
        if (matched.length === 0) continue;
        if (hasConcreteMeasurement(criterion.measurement)) continue;
        findings.push(
          createFinding({
            ruleId: acSubjectiveLanguageWithoutMeasurement.id,
            discriminator: criterion.id,
            severity: "warning",
            sectionPath: `features.${feature.id}.acceptanceCriteria.${criterion.id}`,
            problem: `Criterion "${criterion.id}" uses subjective language (${matched.join(", ")}) without a concrete measurement.`,
            evidence: `criterion: "${criterion.criterion}"; measurement: "${criterion.measurement}".`,
            requiredChange: `Replace the subjective phrase with an observable, measurable requirement (e.g. a time, count, or pass/fail check).`,
            responsibleStage: "feature_expander"
          })
        );
      }
    }
    return findings;
  }
};

const acTestScenarioDepthProxy: PlanGateRule = {
  id: "ac-test-scenario-depth-proxy",
  description: "A feature with fewer test scenarios than acceptance criteria may be under-tested (coarse proxy; TestScenario has no acceptanceCriterionId link today).",
  defaultSeverity: "notice",
  earliestStage: "feature_expander",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const feature of manifest.features) {
      if (feature.testScenarios.length >= feature.acceptanceCriteria.length) continue;
      findings.push(
        createFinding({
          ruleId: acTestScenarioDepthProxy.id,
          discriminator: feature.id,
          severity: "notice",
          sectionPath: `features.${feature.id}.testScenarios`,
          problem: `Feature "${feature.id}" has fewer test scenarios (${feature.testScenarios.length}) than acceptance criteria (${feature.acceptanceCriteria.length}).`,
          evidence: `testScenarios.length=${feature.testScenarios.length}, acceptanceCriteria.length=${feature.acceptanceCriteria.length}.`,
          requiredChange: `Consider adding test scenarios so each acceptance criterion has verifiable coverage.`,
          responsibleStage: "feature_expander"
        })
      );
    }
    return findings;
  }
};

export const acceptanceCriterionQualityRules: PlanGateRule[] = [
  acSubjectiveLanguageWithoutMeasurement,
  acTestScenarioDepthProxy
];
