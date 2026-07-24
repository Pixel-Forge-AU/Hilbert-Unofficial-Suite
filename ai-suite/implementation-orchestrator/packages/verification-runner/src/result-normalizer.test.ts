import { describe, expect, it } from "vitest";
import type { VerificationCheckResult } from "@implementation-orchestrator/contracts";
import { computeOverallPassed } from "./result-normalizer.js";

function check(overrides: Partial<VerificationCheckResult>): VerificationCheckResult {
  return {
    checkId: "c",
    type: "custom_command",
    name: "c",
    passed: true,
    required: true,
    exitCode: 0,
    durationMs: 1,
    ...overrides,
  };
}

describe("computeOverallPassed", () => {
  it("all_required: passes when every required check passes, ignoring optional failures", () => {
    const checks = [check({ required: true, passed: true }), check({ required: false, passed: false })];
    expect(computeOverallPassed(checks, "all_required")).toBe(true);
  });

  it("all_required: fails when a required check fails", () => {
    const checks = [check({ required: true, passed: false }), check({ required: false, passed: true })];
    expect(computeOverallPassed(checks, "all_required")).toBe(false);
  });

  it("all_checks: fails when any check fails, even an optional one", () => {
    const checks = [check({ required: true, passed: true }), check({ required: false, passed: false })];
    expect(computeOverallPassed(checks, "all_checks")).toBe(false);
  });

  it("all_checks: passes only when every check passes", () => {
    const checks = [check({ required: true, passed: true }), check({ required: false, passed: true })];
    expect(computeOverallPassed(checks, "all_checks")).toBe(true);
  });
});
