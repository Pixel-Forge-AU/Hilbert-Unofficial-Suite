import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../fixtures/valid-stage-outputs.js";
import { goldenManifest } from "./golden-manifest.js";

/**
 * Regression guard: VALID_STAGE_OUTPUTS.plan_gate is a hand-authored "clean" fixture.
 * If the rule catalogue ever starts flagging the golden compiled manifest, every
 * orchestrator integration test driven by that fixture would silently start seeing
 * unexpected passed_with_warnings/rejected results. This keeps the two in sync.
 */
describe("plan gate golden fixture", () => {
  it("produces zero findings and no required adjudication against the compiled golden manifest", () => {
    const { findings } = evaluatePlanGate(goldenManifest(), VALID_STAGE_OUTPUTS.plan_critic);
    expect(findings).toEqual([]);
  });
});
