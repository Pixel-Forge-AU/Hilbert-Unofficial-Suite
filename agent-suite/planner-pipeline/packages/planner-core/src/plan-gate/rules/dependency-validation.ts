import type { PlanGateFinding } from "@planner/contracts";
import { detectCycle } from "../graph.js";
import { essentialFeatureIds } from "../coverage.js";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

const DEFERRED_SCOPE_CLASSES = new Set(["experimental", "future", "unnecessary"]);

const depCircularFeatureDependencies: PlanGateRule = {
  id: "dep-circular-feature-dependencies",
  description: "Feature dependency graph must be acyclic.",
  defaultSeverity: "error",
  earliestStage: "feature_expander",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const edges = manifest.features.flatMap((feature) =>
      feature.dependencies.map((dependencyId) => ({ from: feature.id, to: dependencyId }))
    );
    const cycle = detectCycle(edges);
    if (!cycle) return [];
    return [
      createFinding({
        ruleId: depCircularFeatureDependencies.id,
        discriminator: cycle.join(">"),
        severity: "error",
        sectionPath: "features[].dependencies",
        problem: `Circular feature dependency detected: ${cycle.join(" -> ")}.`,
        evidence: `Cycle chain: ${cycle.join(" -> ")}.`,
        requiredChange: "Break the cycle by removing or restructuring one of the dependency edges.",
        responsibleStage: "feature_expander"
      })
    ];
  }
};

const depCircularImplementationGraph: PlanGateRule = {
  id: "dep-circular-implementation-graph",
  description: "Implementation plan dependency graph must be acyclic.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const cycle = detectCycle(manifest.implementationPlan.dependencyGraph);
    if (!cycle) return [];
    return [
      createFinding({
        ruleId: depCircularImplementationGraph.id,
        discriminator: cycle.join(">"),
        severity: "error",
        sectionPath: "implementationPlan.dependencyGraph",
        problem: `Circular dependency in the implementation plan graph: ${cycle.join(" -> ")}.`,
        evidence: `Cycle chain: ${cycle.join(" -> ")}.`,
        requiredChange: "Break the cycle by removing or reordering one of the dependency edges.",
        responsibleStage: "specification_compiler"
      })
    ];
  }
};

const depPhaseFeatureAvailability: PlanGateRule = {
  id: "dep-phase-feature-availability",
  description: "A feature's dependencies must be available in the same phase or an earlier one.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    const earliestPhaseIndex = new Map<string, number>();
    manifest.implementationPlan.phases.forEach((phase, phaseIndex) => {
      for (const featureId of phase.includedFeatureIds) {
        if (!earliestPhaseIndex.has(featureId)) earliestPhaseIndex.set(featureId, phaseIndex);
      }
    });

    for (const feature of manifest.features) {
      const featurePhaseIndex = earliestPhaseIndex.get(feature.id);
      if (featurePhaseIndex === undefined) continue;
      for (const dependencyId of feature.dependencies) {
        const dependencyPhaseIndex = earliestPhaseIndex.get(dependencyId);
        if (dependencyPhaseIndex === undefined) continue;
        if (dependencyPhaseIndex <= featurePhaseIndex) continue;
        findings.push(
          createFinding({
            ruleId: depPhaseFeatureAvailability.id,
            discriminator: `${feature.id}:${dependencyId}`,
            severity: "error",
            sectionPath: "implementationPlan.phases",
            problem: `Feature "${feature.id}" is scheduled before its dependency "${dependencyId}" is available.`,
            evidence: `"${feature.id}" first appears in phase index ${featurePhaseIndex}; "${dependencyId}" first appears in phase index ${dependencyPhaseIndex}.`,
            requiredChange: `Move "${dependencyId}" to a phase at or before the phase containing "${feature.id}".`,
            responsibleStage: "specification_compiler"
          })
        );
      }
    }
    return findings;
  }
};

const depEssentialDependsOnDeferred: PlanGateRule = {
  id: "dep-essential-depends-on-deferred",
  description: "An essential/high-value feature depends on a feature classified as experimental, future, or unnecessary.",
  defaultSeverity: "warning",
  earliestStage: "scope_challenger",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    const essentialIds = essentialFeatureIds(manifest);
    const deferredIds = new Set(
      manifest.scope.classifications
        .filter((classification) => DEFERRED_SCOPE_CLASSES.has(classification.scopeClass))
        .map((classification) => classification.itemId)
    );
    for (const feature of manifest.features) {
      if (!essentialIds.has(feature.id)) continue;
      for (const dependencyId of feature.dependencies) {
        if (!deferredIds.has(dependencyId)) continue;
        findings.push(
          createFinding({
            ruleId: depEssentialDependsOnDeferred.id,
            discriminator: `${feature.id}:${dependencyId}`,
            severity: "warning",
            sectionPath: `features.${feature.id}.dependencies`,
            problem: `Essential feature "${feature.id}" depends on "${dependencyId}", which is scoped as deferred.`,
            evidence: `"${dependencyId}" is classified experimental, future, or unnecessary in scope.classifications.`,
            requiredChange: `Confirm whether "${feature.id}" can ship without "${dependencyId}", or re-scope "${dependencyId}" as essential/high_value.`,
            responsibleStage: "scope_challenger",
            requiresAdjudication: true
          })
        );
      }
    }
    return findings;
  }
};

export const dependencyValidationRules: PlanGateRule[] = [
  depCircularFeatureDependencies,
  depCircularImplementationGraph,
  depPhaseFeatureAvailability,
  depEssentialDependsOnDeferred
];
