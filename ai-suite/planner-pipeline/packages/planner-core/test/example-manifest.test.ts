import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifestSchema } from "@planner/contracts";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(currentDir, "../../../examples/sample-manifest.json");

describe("committed example manifest", () => {
  it("stays valid against the current buildManifestSchema", () => {
    const content = JSON.parse(readFileSync(examplePath, "utf-8"));
    const result = buildManifestSchema.safeParse(content);
    if (!result.success) {
      throw new Error(`examples/sample-manifest.json is stale: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });
});
