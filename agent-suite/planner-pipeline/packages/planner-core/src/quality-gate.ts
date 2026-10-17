import {
  MANDATORY_MANIFEST_SECTIONS,
  qualityGateForStrictness,
  type BuildManifest,
  type PlanCritique,
  type PlanPreferences
} from "@planner/contracts";

export interface QualityGateResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateQualityGate(
  critique: PlanCritique,
  manifest: BuildManifest,
  preferences: PlanPreferences
): QualityGateResult {
  const gate = qualityGateForStrictness(preferences.strictness, preferences.targetQualityScore);
  const reasons: string[] = [];
  if (!critique.passed) reasons.push("Critic marked plan as not passed.");
  if (critique.overallScore < gate.overallScore) {
    reasons.push(`Overall score ${critique.overallScore} is below ${gate.overallScore}.`);
  }
  if (critique.blockingIssues.length > gate.maximumBlockingIssues) {
    reasons.push("Blocking issue limit exceeded.");
  }
  if (critique.majorIssues.length > gate.maximumMajorIssues) {
    reasons.push("Major issue limit exceeded.");
  }
  const lowCategories = Object.entries(critique.categoryScores).filter(
    ([, score]) => score < gate.minimumCategoryScore
  );
  if (lowCategories.length > 0) {
    reasons.push(`Category scores below threshold: ${lowCategories.map(([key]) => key).join(", ")}.`);
  }
  if (gate.requireAllMandatorySections) {
    const missing = MANDATORY_MANIFEST_SECTIONS.filter((key) => manifest[key] === undefined);
    if (missing.length > 0) reasons.push(`Missing mandatory sections: ${missing.join(", ")}.`);
  }
  return { passed: reasons.length === 0, reasons };
}
