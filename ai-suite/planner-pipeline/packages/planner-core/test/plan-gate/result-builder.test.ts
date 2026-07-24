import type { PlanGateCoverage, PlanGateFinding } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { buildPlanGateResult } from "../../src/plan-gate/result-builder.js";

const fullCoverage: PlanGateCoverage = {
  essentialFeaturesWithAcceptanceCriteria: 1,
  essentialFeaturesWithTestScenarios: 1,
  requirementsWithTraceability: 1,
  featuresAssignedToImplementationPhase: 1
};

function finding(overrides: Partial<PlanGateFinding>): PlanGateFinding {
  return {
    id: "rule:1",
    ruleId: "rule",
    severity: "warning",
    sectionPath: "features.F001",
    problem: "problem",
    evidence: "evidence",
    requiredChange: "change",
    responsibleStage: "feature_expander",
    requiresAdjudication: false,
    adjudicationOutcome: null,
    adjudicationRationale: null,
    ...overrides
  };
}

describe("buildPlanGateResult", () => {
  it("decides passed with no findings", () => {
    const result = buildPlanGateResult([], fullCoverage, false);
    expect(result.decision).toBe("passed");
    expect(result.errorCount).toBe(0);
  });

  it("decides passed_with_warnings when only warnings/notices are active", () => {
    const result = buildPlanGateResult(
      [finding({ severity: "warning" }), finding({ id: "rule:2", severity: "notice" })],
      fullCoverage,
      false
    );
    expect(result.decision).toBe("passed_with_warnings");
    expect(result.warningCount).toBe(1);
    expect(result.noticeCount).toBe(1);
  });

  it("decides rejected when any error finding is active", () => {
    const result = buildPlanGateResult([finding({ severity: "error" })], fullCoverage, false);
    expect(result.decision).toBe("rejected");
    expect(result.errorCount).toBe(1);
  });

  it("excludes dismissed findings from counts and decision", () => {
    const result = buildPlanGateResult(
      [finding({ severity: "error", adjudicationOutcome: "dismissed" })],
      fullCoverage,
      true
    );
    expect(result.decision).toBe("passed");
    expect(result.errorCount).toBe(0);
    expect(result.adjudicationUsed).toBe(true);
  });
});
