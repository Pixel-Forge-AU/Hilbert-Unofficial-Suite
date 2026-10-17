import { describe, expect, it } from "vitest";
import { stageOutputSchemas, toPartialStageSchema } from "./stage-output.js";

describe("toPartialStageSchema", () => {
  it("derives a partial schema for every stage without throwing, including superRefine-wrapped ones", () => {
    // edge_case_hunter's full schema is wrapped in .superRefine() (per-category minimum
    // finding counts), which produces a ZodEffects - ZodEffects has no .partial(). This is
    // a real production failure (2026-07-20): calling .partial() directly on it threw
    // "schema.partial is not a function" from inside prompt construction, before patch
    // mode's own try/catch fallback ever got a chance to run. Looping over every real stage
    // schema here means a future stage gaining a superRefine wouldn't silently reintroduce
    // the same crash.
    for (const [stageName, schema] of Object.entries(stageOutputSchemas)) {
      expect(() => toPartialStageSchema(schema), `stage: ${stageName}`).not.toThrow();
    }
  });

  it("accepts an empty object for a superRefine-wrapped schema, since the refinement doesn't apply to a partial patch", () => {
    const partial = toPartialStageSchema(stageOutputSchemas.edge_case_hunter);
    expect(partial.safeParse({}).success).toBe(true);
    // A patch touching only one field must still validate that field's own shape.
    expect(partial.safeParse({ findings: "not an array" }).success).toBe(false);
  });

  it("accepts an empty object for a plain (non-refined) stage schema", () => {
    const partial = toPartialStageSchema(stageOutputSchemas.intent_interpreter);
    expect(partial.safeParse({}).success).toBe(true);
  });
});
