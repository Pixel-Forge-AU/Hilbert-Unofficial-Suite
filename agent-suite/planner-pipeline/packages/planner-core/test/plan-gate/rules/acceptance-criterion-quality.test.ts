import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("acceptance criterion quality rules", () => {
  it("warns on subjective language without a concrete measurement", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.acceptanceCriteria[0]!.criterion = "The search should feel fast and intuitive.";
    manifest.features[0]!.acceptanceCriteria[0]!.measurement = "N/A";

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ac-subjective-language-without-measurement");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
  });

  it("does not warn when a concrete measurement accompanies subjective language", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.acceptanceCriteria[0]!.criterion = "The search should feel fast.";
    manifest.features[0]!.acceptanceCriteria[0]!.measurement = "p95 latency under 300ms in load test.";

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ac-subjective-language-without-measurement");
    expect(matches).toHaveLength(0);
  });

  it("notices a feature with fewer test scenarios than acceptance criteria", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.features[0]!.acceptanceCriteria.push({
      id: "AC002",
      criterion: "Filters narrow results correctly.",
      measurement: "Automated integration test."
    });

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "ac-test-scenario-depth-proxy");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("notice");
  });
});
