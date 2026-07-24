import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("implementation readiness rules", () => {
  it("flags an essential feature missing required fields", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.purpose = "";
    manifest.features[0]!.acceptanceCriteria = [];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "impl-essential-feature-field-completeness");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.evidence).toContain("purpose");
    expect(matches[0]!.evidence).toContain("acceptanceCriteria");
  });

  it("flags an essential feature not assigned to any implementation phase", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.phases[0]!.includedFeatureIds = [];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "impl-essential-feature-phase-assignment");
    expect(matches).toHaveLength(1);
  });

  it("warns when mobile/accessibility behaviour is missing and the feature is not desktop-only", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.mobileBehaviour = [];
    manifest.features[0]!.accessibilityBehaviour = [];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "impl-mobile-accessibility-coverage");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
  });

  it("does not warn when a feature is explicitly marked desktop-only/internal", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.mobileBehaviour = [];
    manifest.features[0]!.accessibilityBehaviour = [];
    manifest.features[0]!.summary = "An internal tool for catalogue admins, desktop only.";

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "impl-mobile-accessibility-coverage");
    expect(matches).toHaveLength(0);
  });
});
