import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("dependency validation rules", () => {
  it("detects a circular feature dependency", () => {
    const manifest = cloneManifest(goldenManifest());
    const second = cloneManifest(goldenManifest()).features[0]!;
    second.id = "F002";
    second.name = "Second feature";
    manifest.features[0]!.dependencies = ["F002"];
    second.dependencies = ["F001"];
    manifest.features.push(second);

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "dep-circular-feature-dependencies");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.evidence).toContain("F001");
    expect(matches[0]!.evidence).toContain("F002");
  });

  it("detects a circular implementation plan dependency graph", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.dependencyGraph = [
      { from: "Search Service", to: "Catalogue Ingestion", reason: "test" },
      { from: "Catalogue Ingestion", to: "Search Service", reason: "test" }
    ];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "dep-circular-implementation-graph");
    expect(matches).toHaveLength(1);
  });

  it("flags a feature scheduled before a dependency it needs", () => {
    const manifest = cloneManifest(goldenManifest());
    const second = cloneManifest(goldenManifest()).features[0]!;
    second.id = "F002";
    second.name = "Second feature";
    manifest.features.push(second);
    manifest.features[0]!.dependencies = ["F002"];
    // F001 (depends on F002) ships in phase P1; F002 only appears in a later phase.
    manifest.implementationPlan.phases.push({
      id: "P2",
      name: "Phase two",
      goal: "Ship the dependency",
      includedFeatureIds: ["F002"],
      exitCriteria: ["Done"]
    });

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "dep-phase-feature-availability");
    expect(matches).toHaveLength(1);
  });

  it("warns and requires adjudication when an essential feature depends on a deferred feature", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.dependencies = ["SF002"];
    manifest.scope.classifications.push({
      itemId: "SF002",
      itemName: "3D part preview",
      scopeClass: "experimental",
      rationale: "test",
      cheaperAlternative: null,
      isSignatureElement: false
    });

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "dep-essential-depends-on-deferred");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
    expect(matches[0]!.requiresAdjudication).toBe(true);
  });
});
