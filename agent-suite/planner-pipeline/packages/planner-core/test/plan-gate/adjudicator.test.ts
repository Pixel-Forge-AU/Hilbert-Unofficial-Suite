import type { PlanGateFinding } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { applyAdjudicationResults, buildAdjudicationPrompt } from "../../src/plan-gate/adjudicator.js";
import { goldenManifest } from "./golden-manifest.js";

function ambiguousFinding(overrides: Partial<PlanGateFinding> = {}): PlanGateFinding {
  return {
    id: "unresolved-decision-impact:UD1",
    ruleId: "unresolved-decision-impact",
    severity: "notice",
    sectionPath: "unresolvedDecisions.UD1",
    problem: "Unresolved decision classification is ambiguous.",
    evidence: "Matched signal(s): provider.",
    requiredChange: "Confirm classification.",
    responsibleStage: "specification_compiler",
    requiresAdjudication: true,
    adjudicationOutcome: null,
    adjudicationRationale: null,
    ...overrides
  };
}

describe("buildAdjudicationPrompt", () => {
  it("includes each ambiguous finding's id and a compact project summary", () => {
    const manifest = goldenManifest();
    const finding = ambiguousFinding();
    const { system, prompt } = buildAdjudicationPrompt([finding], manifest);

    expect(system).toContain("confirm");
    expect(prompt).toContain(finding.id);
    expect(prompt).toContain(manifest.project.title);
    expect(prompt).toContain(manifest.productDirection.experienceThesis);
  });

  it("excludes findings that do not require adjudication", () => {
    const manifest = goldenManifest();
    const notAmbiguous = ambiguousFinding({ id: "other-rule:X", requiresAdjudication: false });
    const { prompt } = buildAdjudicationPrompt([notAmbiguous], manifest);
    expect(prompt).not.toContain("other-rule:X");
  });
});

describe("applyAdjudicationResults", () => {
  it("marks a confirmed finding without changing its severity", () => {
    const finding = ambiguousFinding();
    const [result] = applyAdjudicationResults(
      [finding],
      [{ findingId: finding.id, outcome: "confirmed", rationale: "Still a real concern." }]
    );
    expect(result!.adjudicationOutcome).toBe("confirmed");
    expect(result!.severity).toBe(finding.severity);
  });

  it("marks a dismissed finding as dismissed", () => {
    const finding = ambiguousFinding();
    const [result] = applyAdjudicationResults(
      [finding],
      [{ findingId: finding.id, outcome: "dismissed", rationale: "False positive given context." }]
    );
    expect(result!.adjudicationOutcome).toBe("dismissed");
  });

  it("leaves unmatched findings untouched (does not silently dismiss by omission)", () => {
    const finding = ambiguousFinding();
    const [result] = applyAdjudicationResults([finding], []);
    expect(result!.adjudicationOutcome).toBeNull();
  });
});
