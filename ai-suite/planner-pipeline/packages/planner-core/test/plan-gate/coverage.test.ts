import type { BuildManifest } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { computeCoverage } from "../../src/plan-gate/coverage.js";
import { cloneManifest, goldenManifest } from "./golden-manifest.js";

describe("computeCoverage", () => {
  it("reports full coverage for the golden manifest", () => {
    const coverage = computeCoverage(goldenManifest());
    expect(coverage).toEqual({
      essentialFeaturesWithAcceptanceCriteria: 1,
      essentialFeaturesWithTestScenarios: 1,
      requirementsWithTraceability: 1,
      featuresAssignedToImplementationPhase: 1
    });
  });

  it("computes partial ratios when one of two essential features is missing coverage", () => {
    const manifest = cloneManifest(goldenManifest());
    const second = cloneManifest(goldenManifest()).features[0]!;
    second.id = "F002";
    second.name = "Second feature";
    second.acceptanceCriteria = [];
    second.testScenarios = [];
    manifest.features.push(second);
    manifest.scope.classifications.push({
      itemId: "F002",
      itemName: "Second feature",
      scopeClass: "essential",
      rationale: "Also essential.",
      cheaperAlternative: null,
      isSignatureElement: false
    });

    const coverage = computeCoverage(manifest);
    expect(coverage.essentialFeaturesWithAcceptanceCriteria).toBeCloseTo(0.5);
    expect(coverage.essentialFeaturesWithTestScenarios).toBeCloseTo(0.5);
    expect(coverage.featuresAssignedToImplementationPhase).toBeCloseTo(0.5);
  });

  it("treats 0/0 as full coverage (vacuously satisfied)", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.scope.classifications = [];
    manifest.traceability = { entries: [], untracedItems: [] };
    const coverage = computeCoverage(manifest satisfies BuildManifest);
    expect(coverage.essentialFeaturesWithAcceptanceCriteria).toBe(1);
    expect(coverage.essentialFeaturesWithTestScenarios).toBe(1);
    expect(coverage.requirementsWithTraceability).toBe(1);
  });
});
