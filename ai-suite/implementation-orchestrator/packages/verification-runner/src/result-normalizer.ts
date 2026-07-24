import type { VerificationCheckResult, VerificationPassPolicy } from "@implementation-orchestrator/contracts";

export function computeOverallPassed(checks: VerificationCheckResult[], passPolicy: VerificationPassPolicy): boolean {
  if (passPolicy === "all_checks") {
    return checks.every((check) => check.passed);
  }
  return checks.filter((check) => check.required).every((check) => check.passed);
}
