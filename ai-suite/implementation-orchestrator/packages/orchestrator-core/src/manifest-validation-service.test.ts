import type { BuildManifest } from "@implementation-orchestrator/contracts";
import { fixtureRichManifest } from "@implementation-orchestrator/contracts";
import { describe, expect, it } from "vitest";
import { ManifestValidationService } from "./manifest-validation-service.js";

const service = new ManifestValidationService();

function baseManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return fixtureRichManifest(overrides);
}

describe("ManifestValidationService", () => {
  it("accepts a well-formed manifest with essential feature coverage", () => {
    const result = service.validate(baseManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.manifest).toBeDefined();
  });

  it("rejects a manifest missing required top-level fields", () => {
    const result = service.validate({ manifestId: "m1" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an unsupported manifest version", () => {
    const manifest = baseManifest({ manifestVersion: "99.0.0" });
    const result = service.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unsupported manifest version"))).toBe(true);
  });

  it("rejects a manifest with no essential features", () => {
    const manifest = baseManifest();
    manifest.scope.classifications[0]!.scopeClass = "unnecessary";
    const result = service.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("essential feature"))).toBe(true);
  });

  it("rejects a feature with no acceptance criteria (enforced at the schema level: every feature requires at least one)", () => {
    const manifest = baseManifest();
    manifest.features[0]!.acceptanceCriteria = [];
    const result = service.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("acceptanceCriteria"))).toBe(true);
  });

  it("rejects a phase referencing an unknown feature", () => {
    const manifest = baseManifest();
    manifest.implementationPlan.phases[0]!.includedFeatureIds = ["does-not-exist"];
    const result = service.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown feature"))).toBe(true);
  });

  it("warns about features not referenced by any phase without failing validation", () => {
    const manifest = baseManifest();
    const second = fixtureRichManifest().features[0]!;
    second.id = "f2";
    second.name = "Feature Two";
    manifest.features.push(second);
    manifest.scope.classifications.push({
      itemId: "f2",
      itemName: "Feature Two",
      scopeClass: "experimental",
      rationale: "Not part of the first release.",
      cheaperAlternative: null,
      isSignatureElement: false,
    });
    const result = service.validate(manifest);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("f2"))).toBe(true);
  });

  it("rejects a manifest whose plan gate decision is 'rejected'", () => {
    const manifest = baseManifest();
    manifest.planGate = {
      ...manifest.planGate,
      decision: "rejected",
      errorCount: 1,
      findings: [
        {
          id: "rule:1",
          ruleId: "rule",
          severity: "error",
          sectionPath: "features.F001",
          problem: "Something is wrong.",
          evidence: "evidence",
          requiredChange: "fix it",
          responsibleStage: "feature_expander",
          requiresAdjudication: false,
          adjudicationOutcome: null,
          adjudicationRationale: null,
        },
      ],
    };
    const result = service.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("plan gate decision is \"rejected\""))).toBe(true);
  });

  it("accepts a manifest whose plan gate decision is 'passed_with_warnings'", () => {
    const manifest = baseManifest();
    manifest.planGate = {
      ...manifest.planGate,
      decision: "passed_with_warnings",
      warningCount: 1,
      findings: [
        {
          id: "rule:1",
          ruleId: "rule",
          severity: "warning",
          sectionPath: "features.F001",
          problem: "Minor issue.",
          evidence: "evidence",
          requiredChange: "consider fixing",
          responsibleStage: "feature_expander",
          requiresAdjudication: false,
          adjudicationOutcome: null,
          adjudicationRationale: null,
        },
      ],
    };
    const result = service.validate(manifest);
    expect(result.valid).toBe(true);
  });
});
