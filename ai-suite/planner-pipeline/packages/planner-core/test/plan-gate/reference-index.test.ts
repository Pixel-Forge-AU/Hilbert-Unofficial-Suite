import { describe, expect, it } from "vitest";
import { ReferenceIndex } from "../../src/plan-gate/reference-index.js";
import { goldenManifest } from "./golden-manifest.js";

describe("ReferenceIndex", () => {
  const referenceIndex = new ReferenceIndex(goldenManifest());

  it("resolves known and rejects unknown feature ids", () => {
    expect(referenceIndex.has("feature", "F001")).toBe(true);
    expect(referenceIndex.has("feature", "F999")).toBe(false);
  });

  it("resolves known and rejects unknown journey ids", () => {
    expect(referenceIndex.has("journey", "J001")).toBe(true);
    expect(referenceIndex.has("journey", "J999")).toBe(false);
  });

  it("resolves architecture decision ids", () => {
    expect(referenceIndex.has("architectureDecision", "ADR001")).toBe(true);
    expect(referenceIndex.has("architectureDecision", "ADR999")).toBe(false);
  });

  it("resolves acceptance criteria and test scenario ids", () => {
    expect(referenceIndex.has("acceptanceCriterion", "AC001")).toBe(true);
    expect(referenceIndex.has("acceptanceCriterion", "AC999")).toBe(false);
    expect(referenceIndex.has("testScenario", "TS001")).toBe(true);
    expect(referenceIndex.has("testScenario", "TS999")).toBe(false);
  });

  it("resolves phase ids", () => {
    expect(referenceIndex.has("phase", "P1")).toBe(true);
    expect(referenceIndex.has("phase", "P9")).toBe(false);
  });

  it("resolves scope items against features and signature features", () => {
    expect(referenceIndex.has("scopeItem", "F001")).toBe(true);
    expect(referenceIndex.has("scopeItem", "SF002")).toBe(true);
    expect(referenceIndex.has("scopeItem", "SF999")).toBe(false);
  });

  it("resolves dependency graph labels case-insensitively", () => {
    expect(referenceIndex.has("dependencyGraphLabel", "Search Service")).toBe(true);
    expect(referenceIndex.has("dependencyGraphLabel", "search service")).toBe(true);
    expect(referenceIndex.has("dependencyGraphLabel", "SEARCH SERVICE")).toBe(true);
    expect(referenceIndex.has("dependencyGraphLabel", "Catalogue Ingestion")).toBe(true);
    expect(referenceIndex.has("dependencyGraphLabel", "Nonexistent Module")).toBe(false);
  });
});
