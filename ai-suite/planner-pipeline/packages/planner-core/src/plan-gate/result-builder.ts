import type { PlanGateCoverage, PlanGateDecision, PlanGateFinding, PlanGateResult, PlanGateSeverity } from "@planner/contracts";

function isActive(finding: PlanGateFinding): boolean {
  return finding.adjudicationOutcome !== "dismissed";
}

function countBySeverity(findings: PlanGateFinding[], severity: PlanGateSeverity): number {
  return findings.filter((finding) => isActive(finding) && finding.severity === severity).length;
}

export function buildPlanGateResult(
  findings: PlanGateFinding[],
  coverage: PlanGateCoverage,
  adjudicationUsed: boolean
): PlanGateResult {
  const errorCount = countBySeverity(findings, "error");
  const warningCount = countBySeverity(findings, "warning");
  const noticeCount = countBySeverity(findings, "notice");

  const decision: PlanGateDecision = errorCount > 0 ? "rejected" : warningCount > 0 ? "passed_with_warnings" : "passed";

  const summary =
    findings.length === 0
      ? "The compiled manifest is internally consistent, fully referenced, and implementation-ready with no findings."
      : `Decision: ${decision}. ${errorCount} error(s), ${warningCount} warning(s), ${noticeCount} notice(s) across ${findings.length} finding(s).`;

  return {
    decision,
    findings,
    errorCount,
    warningCount,
    noticeCount,
    coverage,
    adjudicationUsed,
    summary
  };
}
