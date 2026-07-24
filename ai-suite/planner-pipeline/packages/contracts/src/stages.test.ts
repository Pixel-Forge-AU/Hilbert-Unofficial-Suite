import { describe, expect, it } from "vitest";
import { EDGE_CASE_MINIMUMS, edgeCaseReportSchema, type EdgeCaseFinding } from "./stages.js";

function finding(category: EdgeCaseFinding["category"], index: number): EdgeCaseFinding {
  return {
    id: `${category}-${index}`,
    category,
    scenario: `Scenario ${index}`,
    trigger: `Trigger ${index}`,
    expectedBehaviour: "Expected",
    currentGap: "Gap",
    severity: "medium",
    affectedFeatures: [],
    requiredMitigation: "Mitigate"
  };
}

function reportWithCounts(counts: Partial<Record<EdgeCaseFinding["category"], number>>) {
  const findings: EdgeCaseFinding[] = [];
  for (const [category, count] of Object.entries(counts)) {
    for (let i = 0; i < (count ?? 0); i += 1) {
      findings.push(finding(category as EdgeCaseFinding["category"], i));
    }
  }
  return {
    findings,
    systemicRisks: [],
    highestRiskAreas: ["one"],
    missingRecoveryPatterns: [],
    requiredPlanChanges: []
  };
}

describe("edgeCaseReportSchema", () => {
  it("rejects reports that fall short of the required per-category minimums", () => {
    const report = reportWithCounts({ behaviour: 1, data: 1, visual: 1, mobile: 1, accessibility: 1, security: 1, operations: 1 });
    const result = edgeCaseReportSchema.safeParse(report);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBe(Object.keys(EDGE_CASE_MINIMUMS).length);
    }
  });

  it("accepts a report meeting every category minimum", () => {
    const report = reportWithCounts(EDGE_CASE_MINIMUMS);
    const result = edgeCaseReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});
