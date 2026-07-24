import { PLANNER_STAGE_NAMES, stageOutputSchemas } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { VALID_STAGE_OUTPUTS, failingCritique } from "./valid-stage-outputs.js";

describe("valid stage output fixtures", () => {
  for (const stage of PLANNER_STAGE_NAMES) {
    it(`${stage} fixture satisfies its schema`, () => {
      const result = stageOutputSchemas[stage].safeParse(VALID_STAGE_OUTPUTS[stage]);
      if (!result.success) {
        throw new Error(`${stage} fixture is invalid: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.success).toBe(true);
    });
  }

  it("failing critique fixture also satisfies the critic schema", () => {
    const result = stageOutputSchemas.plan_critic.safeParse(failingCritique);
    expect(result.success).toBe(true);
  });
});
