import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, parseStructured } from "./structured-output.js";

describe("structured output parsing", () => {
  it("extracts fenced JSON", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("skips non-JSON braces before the actual JSON object", () => {
    expect(extractJson('Use {placeholders} internally. Final JSON: {"ok":true}')).toEqual({ ok: true });
  });

  it("parses the first balanced JSON value without trailing commentary", () => {
    expect(extractJson('{"message":"brace } in string","items":[1,2]}\nDone.')).toEqual({
      message: "brace } in string",
      items: [1, 2]
    });
  });

  it("validates parsed JSON with Zod", () => {
    const schema = z.object({ name: z.string() });
    expect(parseStructured(schema, '{"name":"planner"}')).toEqual({ name: "planner" });
  });
});
