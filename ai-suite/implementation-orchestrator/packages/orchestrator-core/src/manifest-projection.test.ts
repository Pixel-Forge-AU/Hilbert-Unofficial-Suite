import { fixtureRichManifest } from "@implementation-orchestrator/contracts";
import { describe, expect, it } from "vitest";
import { deriveCompilationManifest } from "./manifest-projection.js";

function secondFeature() {
  const feature = fixtureRichManifest().features[0]!;
  feature.id = "F002";
  feature.name = "Second feature";
  return feature;
}

describe("deriveCompilationManifest", () => {
  it("passes through manifestId, manifestVersion, and name (from project.title)", () => {
    const rich = fixtureRichManifest();
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.manifestId).toBe(rich.manifestId);
    expect(compiled.manifestVersion).toBe(rich.manifestVersion);
    expect(compiled.name).toBe(rich.project.title);
  });

  it("combines summary and purpose into the compiled feature description", () => {
    const rich = fixtureRichManifest();
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.features[0]!.description).toBe(`${rich.features[0]!.summary}\n\n${rich.features[0]!.purpose}`);
  });

  it("maps scope classes to compilation priority per the documented table", () => {
    const table: Array<[string, "essential" | "high_value" | "optional"]> = [
      ["essential", "essential"],
      ["high_value", "high_value"],
      ["delight", "high_value"],
      ["experimental", "optional"],
      ["future", "optional"],
      ["unnecessary", "optional"],
    ];
    for (const [scopeClass, expectedPriority] of table) {
      const rich = fixtureRichManifest();
      rich.scope.classifications[0]!.scopeClass = scopeClass as never;
      const compiled = deriveCompilationManifest(rich);
      expect(compiled.features[0]!.priority).toBe(expectedPriority);
    }
  });

  it("defaults unclassified features to high_value", () => {
    const rich = fixtureRichManifest();
    rich.scope.classifications = [];
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.features[0]!.priority).toBe("high_value");
  });

  it("passes through feature.dependencies as dependsOn", () => {
    const rich = fixtureRichManifest();
    rich.features.push(secondFeature());
    rich.features[0]!.dependencies = ["F002"];
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.features[0]!.dependsOn).toEqual(["F002"]);
  });

  it("constructs acceptance criteria and test scenario descriptions", () => {
    const rich = fixtureRichManifest();
    const compiled = deriveCompilationManifest(rich);
    const ac = rich.features[0]!.acceptanceCriteria[0]!;
    const ts = rich.features[0]!.testScenarios[0]!;
    expect(compiled.features[0]!.acceptanceCriteria[0]).toEqual({
      id: ac.id,
      description: `${ac.criterion} — measured by: ${ac.measurement}`,
      required: true,
    });
    expect(compiled.features[0]!.testScenarios[0]).toEqual({
      id: ts.id,
      description: `${ts.name}: Given ${ts.given}, when ${ts.when}, then ${ts.then}.`,
      required: true,
    });
  });

  it("derives phase.order from array index and phase.description from goal", () => {
    const rich = fixtureRichManifest();
    rich.implementationPlan.phases.push({
      id: "P2",
      name: "Phase Two",
      goal: "Second phase goal",
      includedFeatureIds: [],
      exitCriteria: ["Done"],
    });
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.phases[0]!.order).toBe(0);
    expect(compiled.phases[1]!.order).toBe(1);
    expect(compiled.phases[0]!.description).toBe(rich.implementationPlan.phases[0]!.goal);
  });

  it("derives phase.featureIds from includedFeatureIds", () => {
    const rich = fixtureRichManifest();
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.phases[0]!.featureIds).toEqual(rich.implementationPlan.phases[0]!.includedFeatureIds);
  });

  it("derives phase.dependsOn as a strict sequential chain", () => {
    const rich = fixtureRichManifest();
    rich.implementationPlan.phases.push(
      { id: "P2", name: "Phase Two", goal: "g2", includedFeatureIds: [], exitCriteria: ["Done"] },
      { id: "P3", name: "Phase Three", goal: "g3", includedFeatureIds: [], exitCriteria: ["Done"] },
    );
    const compiled = deriveCompilationManifest(rich);
    expect(compiled.phases[0]!.dependsOn).toEqual([]);
    expect(compiled.phases[1]!.dependsOn).toEqual(["P1"]);
    expect(compiled.phases[2]!.dependsOn).toEqual(["P2"]);
  });
});
