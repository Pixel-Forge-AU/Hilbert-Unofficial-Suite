import type { BuildManifest, PlanGateAdjudicationResult, PlanGateFinding } from "@planner/contracts";

function excerptForFinding(finding: PlanGateFinding, manifest: BuildManifest): string {
  if (finding.ruleId === "unresolved-decision-impact") {
    const decisionId = finding.id.split(":")[1];
    const decision = manifest.unresolvedDecisions.find((entry) => entry.id === decisionId);
    if (decision) return JSON.stringify(decision, null, 2);
  }
  if (finding.ruleId === "dep-essential-depends-on-deferred") {
    const [, featureId, dependencyId] = finding.id.split(":");
    const excerpt = manifest.features
      .filter((feature) => feature.id === featureId || feature.id === dependencyId)
      .map((feature) => ({ id: feature.id, name: feature.name, dependencies: feature.dependencies }));
    const scopeExcerpt = manifest.scope.classifications.filter(
      (classification) => classification.itemId === featureId || classification.itemId === dependencyId
    );
    return JSON.stringify({ features: excerpt, scope: scopeExcerpt }, null, 2);
  }
  return finding.evidence;
}

export function buildAdjudicationPrompt(
  findings: PlanGateFinding[],
  manifest: BuildManifest
): { system: string; prompt: string } {
  const ambiguous = findings.filter((finding) => finding.requiresAdjudication);
  return {
    system: [
      "You are adjudicating a small set of already-identified, ambiguous findings from a deterministic plan gate.",
      "You are not reviewing the plan as a whole and must not raise new findings.",
      "For each finding, confirm it (the concern is real and should stand) or dismiss it (it is a false positive given the context).",
      "Return only valid JSON matching the requested schema."
    ].join("\n"),
    prompt: [
      "Project:",
      manifest.project.title,
      manifest.project.brief.slice(0, 500),
      "",
      "Experience thesis:",
      manifest.productDirection.experienceThesis,
      "",
      "Findings requiring adjudication:",
      JSON.stringify(
        ambiguous.map((finding) => ({
          findingId: finding.id,
          ruleId: finding.ruleId,
          problem: finding.problem,
          excerpt: excerptForFinding(finding, manifest)
        })),
        null,
        2
      )
    ].join("\n")
  };
}

export function applyAdjudicationResults(
  findings: PlanGateFinding[],
  results: PlanGateAdjudicationResult[]
): PlanGateFinding[] {
  const byFindingId = new Map(results.map((result) => [result.findingId, result]));
  return findings.map((finding) => {
    const result = byFindingId.get(finding.id);
    if (!result) return finding;
    return { ...finding, adjudicationOutcome: result.outcome, adjudicationRationale: result.rationale };
  });
}
