import type { PlanGateFinding } from "@planner/contracts";
import { essentialFeatureIds } from "../coverage.js";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

const DESKTOP_ONLY_MARKERS = ["desktop only", "desktop-only", "admin panel", "internal tool"];

function isDesktopOnly(searchable: string[]): boolean {
  const haystack = searchable.join(" ").toLowerCase();
  return DESKTOP_ONLY_MARKERS.some((marker) => haystack.includes(marker));
}

const implEssentialFeatureFieldCompleteness: PlanGateRule = {
  id: "impl-essential-feature-field-completeness",
  description: "Essential/high-value features must have purpose, actors, a primary flow, acceptance criteria, and test scenarios.",
  defaultSeverity: "error",
  earliestStage: "scope_challenger",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    const essentialIds = essentialFeatureIds(manifest);
    for (const feature of manifest.features) {
      if (!essentialIds.has(feature.id)) continue;
      const missing: string[] = [];
      if (!feature.purpose.trim()) missing.push("purpose");
      if (feature.actors.length === 0) missing.push("actors");
      if (feature.primaryFlow.length === 0) missing.push("primaryFlow");
      if (feature.acceptanceCriteria.length === 0) missing.push("acceptanceCriteria");
      if (feature.testScenarios.length === 0) missing.push("testScenarios");
      if (missing.length === 0) continue;
      findings.push(
        createFinding({
          ruleId: implEssentialFeatureFieldCompleteness.id,
          discriminator: feature.id,
          severity: "error",
          sectionPath: `features.${feature.id}`,
          problem: `Essential feature "${feature.id}" is missing required field(s): ${missing.join(", ")}.`,
          evidence: `Empty field(s): ${missing.join(", ")}.`,
          requiredChange: `Populate ${missing.join(", ")} on feature "${feature.id}" before implementation can begin.`,
          responsibleStage: "feature_expander"
        })
      );
    }
    return findings;
  }
};

const implEssentialFeaturePhaseAssignment: PlanGateRule = {
  id: "impl-essential-feature-phase-assignment",
  description: "Essential/high-value features must be assigned to at least one implementation phase.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    const essentialIds = essentialFeatureIds(manifest);
    const assignedFeatureIds = new Set(
      manifest.implementationPlan.phases.flatMap((phase) => phase.includedFeatureIds)
    );
    for (const feature of manifest.features) {
      if (!essentialIds.has(feature.id)) continue;
      if (assignedFeatureIds.has(feature.id)) continue;
      findings.push(
        createFinding({
          ruleId: implEssentialFeaturePhaseAssignment.id,
          discriminator: feature.id,
          severity: "error",
          sectionPath: "implementationPlan.phases",
          problem: `Essential feature "${feature.id}" is not assigned to any implementation phase.`,
          evidence: `No implementationPlan.phases[].includedFeatureIds entry contains "${feature.id}".`,
          requiredChange: `Add "${feature.id}" to the includedFeatureIds of the phase that builds it.`,
          responsibleStage: "specification_compiler"
        })
      );
    }
    return findings;
  }
};

const implMobileAccessibilityCoverage: PlanGateRule = {
  id: "impl-mobile-accessibility-coverage",
  description: "Features should define mobile and accessibility behaviour unless they are clearly desktop-only.",
  defaultSeverity: "warning",
  earliestStage: "feature_expander",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const feature of manifest.features) {
      if (isDesktopOnly([...feature.entryPoints, ...feature.actors, ...feature.mobileBehaviour, feature.summary])) {
        continue;
      }
      const missing: string[] = [];
      if (feature.mobileBehaviour.length === 0) missing.push("mobileBehaviour");
      if (feature.accessibilityBehaviour.length === 0) missing.push("accessibilityBehaviour");
      if (missing.length === 0) continue;
      findings.push(
        createFinding({
          ruleId: implMobileAccessibilityCoverage.id,
          discriminator: feature.id,
          severity: "warning",
          sectionPath: `features.${feature.id}`,
          problem: `Feature "${feature.id}" has no ${missing.join(" or ")} defined and is not marked desktop-only/internal.`,
          evidence: `Empty field(s): ${missing.join(", ")}.`,
          requiredChange: `Define ${missing.join(" and ")} for "${feature.id}", or note it is desktop-only/internal.`,
          responsibleStage: "feature_expander"
        })
      );
    }
    return findings;
  }
};

export const implementationReadinessRules: PlanGateRule[] = [
  implEssentialFeatureFieldCompleteness,
  implEssentialFeaturePhaseAssignment,
  implMobileAccessibilityCoverage
];
