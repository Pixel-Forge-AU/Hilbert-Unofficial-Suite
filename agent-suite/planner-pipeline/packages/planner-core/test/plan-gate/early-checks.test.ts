import type { FeatureExpansion } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { buildPartialManifest } from "../../src/plan-gate/partial-manifest.js";
import { evaluateEarlyPlanGateChecks, findingsEligibleForImmediateRetry } from "../../src/plan-gate/early-checks.js";
import { VALID_STAGE_OUTPUTS } from "../fixtures/valid-stage-outputs.js";
import { goldenProject } from "./golden-manifest.js";

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("evaluateEarlyPlanGateChecks", () => {
  it("produces zero findings at every checkpoint against clean outputs (matches the golden fixture)", () => {
    // Mirrors STAGE_ORDER: every preceding stage's output must be present, not just the ones
    // that happen to own a rule's earliestStage, since that's what the real orchestrator loop
    // guarantees by the time it reaches each checkpoint.
    const stageOrder = [
      "intent_interpreter",
      "concept_generator",
      "creative_director",
      "feature_expander",
      "ux_designer",
      "art_director",
      "systems_architect",
      "edge_case_hunter",
      "scope_challenger",
      "specification_compiler"
    ] as const;
    const checkpoints = new Set(["feature_expander", "ux_designer", "scope_challenger", "specification_compiler"]);
    let outputs: Partial<typeof VALID_STAGE_OUTPUTS> = {};
    for (const stageName of stageOrder) {
      outputs = { ...outputs, [stageName]: VALID_STAGE_OUTPUTS[stageName] };
      if (!checkpoints.has(stageName)) continue;
      const manifest = buildPartialManifest(goldenProject, outputs);
      expect(evaluateEarlyPlanGateChecks(stageName, manifest)).toEqual([]);
    }
  });

  it("returns no findings for a stage with no rules registered at its checkpoint", () => {
    const manifest = buildPartialManifest(goldenProject, { intent_interpreter: VALID_STAGE_OUTPUTS.intent_interpreter });
    expect(evaluateEarlyPlanGateChecks("intent_interpreter", manifest)).toEqual([]);
  });

  it("filters out a dangling feature dependency because attemptAutoRepair fixes it for free", () => {
    const broken = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    broken.features[0]!.dependencies = ["F999"];
    const manifest = buildPartialManifest(goldenProject, { feature_expander: broken });
    expect(evaluateEarlyPlanGateChecks("feature_expander", manifest)).toEqual([]);
  });

  it("surfaces a circular feature dependency, which is not auto-repairable", () => {
    const broken = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    broken.features[0]!.dependencies = [broken.features[0]!.id];
    const manifest = buildPartialManifest(goldenProject, { feature_expander: broken });
    const findings = evaluateEarlyPlanGateChecks("feature_expander", manifest);
    expect(findings.map((finding) => finding.ruleId)).toContain("dep-circular-feature-dependencies");
  });
});

describe("findingsEligibleForImmediateRetry", () => {
  it("keeps only error-severity findings whose responsibleStage matches the stage that just ran", () => {
    const findings = [
      { severity: "error", responsibleStage: "feature_expander" } as never,
      { severity: "warning", responsibleStage: "feature_expander" } as never,
      { severity: "error", responsibleStage: "scope_challenger" } as never
    ];
    const eligible = findingsEligibleForImmediateRetry(findings, "feature_expander");
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toBe(findings[0]);
  });
});
