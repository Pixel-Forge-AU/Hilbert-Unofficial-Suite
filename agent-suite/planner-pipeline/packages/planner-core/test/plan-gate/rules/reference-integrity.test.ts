import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("reference integrity rules", () => {
  it("produces no findings for the golden manifest", () => {
    const { findings } = evaluatePlanGate(goldenManifest(), VALID_STAGE_OUTPUTS.plan_critic);
    const referenceFindings = findings.filter((finding) => finding.ruleId.startsWith("ref-"));
    expect(referenceFindings).toEqual([]);
  });

  it("flags a feature dependency that references an unknown feature id", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.dependencies = ["F999"];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ref-feature-dependency-ids");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("error");
    expect(matches[0]!.responsibleStage).toBe("feature_expander");
  });

  it("flags a traceability entry referencing an unknown acceptance criterion", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.traceability.entries[0]!.acceptanceCriteriaIds = ["AC999"];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ref-traceability-entry-ids");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("error");
  });

  it("flags an implementation phase referencing an unknown feature id", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.phases[0]!.includedFeatureIds = ["F999"];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ref-implementation-plan-ids");
    expect(matches).toHaveLength(1);
  });

  it("warns (does not error) on an unrecognized dependency graph label", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.dependencyGraph = [{ from: "Unknown Module", to: "Search Service", reason: "test" }];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ref-dependency-graph-labels");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
  });

  it("flags a scope classification referencing an unknown item", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.scope.classifications.push({
      itemId: "SF999",
      itemName: "Unknown item",
      scopeClass: "future",
      rationale: "test",
      cheaperAlternative: null,
      isSignatureElement: false
    });

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ref-scope-classification-ids");
    expect(matches).toHaveLength(1);
  });
});
