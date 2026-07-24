import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../../src/plan-gate/evaluate.js";
import { VALID_STAGE_OUTPUTS } from "../../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "../golden-manifest.js";

describe("unresolved decision impact rule", () => {
  it("produces no finding for the golden fixture's non-ambiguous task_local decision", () => {
    const { findings } = evaluatePlanGate(goldenManifest(), VALID_STAGE_OUTPUTS.plan_critic);
    expect(findings.filter((finding) => finding.ruleId === "unresolved-decision-impact")).toHaveLength(0);
  });

  it("rejects (error severity) an implementation-blocking unresolved decision", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.unresolvedDecisions = [
      {
        id: "UD1",
        decision: "Which authentication provider should we use?",
        options: ["Auth0", "Build in-house"],
        recommendation: "Auth0",
        blockedBy: "awaiting stakeholder input"
      }
    ];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "unresolved-decision-impact");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("error");
    expect(matches[0]!.responsibleStage).toBe("systems_architect");
    expect(matches[0]!.requiresAdjudication).toBe(false);
  });

  it("warns (phase_blocking) on a pricing/onboarding decision", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.unresolvedDecisions = [
      {
        id: "UD1",
        decision: "What should the pricing model be for premium features?",
        options: ["Subscription", "One-time purchase"],
        recommendation: "Subscription",
        blockedBy: "awaiting stakeholder input"
      }
    ];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "unresolved-decision-impact");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.severity).toBe("warning");
    expect(matches[0]!.responsibleStage).toBe("scope_challenger");
  });

  it("flags an ambiguous (borderline) decision and routes it for adjudication", () => {
    const manifest = cloneManifest(goldenManifest());
    manifest.unresolvedDecisions = [
      {
        id: "UD1",
        decision: "Which mapping provider should we use for displaying part locations?",
        options: ["Google Maps", "Mapbox"],
        recommendation: "Mapbox",
        blockedBy: "awaiting stakeholder input"
      }
    ];

    const { findings } = evaluatePlanGate(manifest, VALID_STAGE_OUTPUTS.plan_critic);
    const matches = findings.filter((finding) => finding.ruleId === "unresolved-decision-impact");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.requiresAdjudication).toBe(true);
  });
});
