import type { BuildManifest, PlanGateCoverage } from "@planner/contracts";

const ESSENTIAL_SCOPE_CLASSES = new Set(["essential", "high_value"]);

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

export function essentialFeatureIds(manifest: BuildManifest): Set<string> {
  return new Set(
    manifest.scope.classifications
      .filter((classification) => ESSENTIAL_SCOPE_CLASSES.has(classification.scopeClass))
      .map((classification) => classification.itemId)
  );
}

export function computeCoverage(manifest: BuildManifest): PlanGateCoverage {
  const essentialIds = essentialFeatureIds(manifest);
  const essentialFeatures = manifest.features.filter((feature) => essentialIds.has(feature.id));

  const assignedFeatureIds = new Set(
    manifest.implementationPlan.phases.flatMap((phase) => phase.includedFeatureIds)
  );

  return {
    essentialFeaturesWithAcceptanceCriteria: ratio(
      essentialFeatures.filter((feature) => feature.acceptanceCriteria.length > 0).length,
      essentialFeatures.length
    ),
    essentialFeaturesWithTestScenarios: ratio(
      essentialFeatures.filter((feature) => feature.testScenarios.length > 0).length,
      essentialFeatures.length
    ),
    requirementsWithTraceability: ratio(
      manifest.traceability.entries.length,
      manifest.traceability.entries.length + manifest.traceability.untracedItems.length
    ),
    featuresAssignedToImplementationPhase: ratio(
      manifest.features.filter((feature) => assignedFeatureIds.has(feature.id)).length,
      manifest.features.length
    )
  };
}
