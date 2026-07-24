import { describe, expect, it } from "vitest";
import { hashManifest } from "./hash.js";

describe("hashManifest", () => {
  it("is stable across key ordering", () => {
    const a = { manifestId: "m1", name: "x", features: [{ id: "f1", priority: "essential" }] };
    const b = { features: [{ priority: "essential", id: "f1" }], name: "x", manifestId: "m1" };
    expect(hashManifest(a)).toBe(hashManifest(b));
  });

  it("changes when content changes", () => {
    const a = { manifestId: "m1" };
    const b = { manifestId: "m2" };
    expect(hashManifest(a)).not.toBe(hashManifest(b));
  });
});
