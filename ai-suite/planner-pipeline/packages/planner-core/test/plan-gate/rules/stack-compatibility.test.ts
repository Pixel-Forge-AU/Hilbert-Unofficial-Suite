import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("stack compatibility rules", () => {
  it("warns when database changes are planned without a migration strategy", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.architecture.migrationStrategy.steps = [];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "stack-migration-strategy-for-db-changes");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
  });

  it("errors when an irreversible database change has no rollback strategy", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.databaseChanges[0]!.reversible = false;
    manifest.architecture.rollbackStrategy.steps = [];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter(
      (finding) => finding.ruleId === "stack-rollback-strategy-for-irreversible-changes"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("error");
  });

  it("does not error when an irreversible change has a declared rollback strategy", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.implementationPlan.databaseChanges[0]!.reversible = false;

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter(
      (finding) => finding.ruleId === "stack-rollback-strategy-for-irreversible-changes"
    );
    expect(matches).toHaveLength(0);
  });
});
