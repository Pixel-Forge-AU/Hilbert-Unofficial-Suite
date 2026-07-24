import type { VerificationCheckResult } from "@implementation-orchestrator/contracts";

export interface FailedCheckEvidence {
  name: string;
  exitCode: number | null;
  summary: string;
}

export function summarizeFailedChecks(checks: VerificationCheckResult[]): FailedCheckEvidence[] {
  return checks
    .filter((check) => !check.passed)
    .map((check) => ({
      name: check.name,
      exitCode: check.exitCode ?? null,
      summary: check.summary ?? "No further detail was captured for this check.",
    }));
}
