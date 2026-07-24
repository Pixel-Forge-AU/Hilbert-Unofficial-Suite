import type {
  CompilationManifest,
  CompilationCoverage,
  CompilerCoverageGap,
  ExecutableTask,
} from "@implementation-orchestrator/contracts";

function ratio(covered: number, total: number): number {
  return total === 0 ? 1 : covered / total;
}

export function computeCoverage(manifest: CompilationManifest, tasks: ExecutableTask[]): CompilationCoverage {
  const featureTasks = tasks.filter((t) => t.sourceFeatureIds.length > 0);
  const coveredFeatureIds = new Set(featureTasks.flatMap((t) => t.sourceFeatureIds));
  const coveredAcceptanceCriteriaIds = new Set(featureTasks.flatMap((t) => t.sourceAcceptanceCriteriaIds));
  const testCoveredFeatureIds = new Set(
    featureTasks
      .filter((t) => t.verification.checks.some((c) => c.type === "unit_test" || c.type === "integration_test"))
      .flatMap((t) => t.sourceFeatureIds),
  );

  const unresolvedItems: CompilerCoverageGap[] = [];

  const essentialFeatures = manifest.features.filter((f) => f.priority === "essential");
  const essentialCovered = essentialFeatures.filter((f) => coveredFeatureIds.has(f.id));
  for (const feature of essentialFeatures) {
    if (!coveredFeatureIds.has(feature.id)) {
      unresolvedItems.push({
        kind: "essential_feature",
        id: feature.id,
        reason: "No compiled task references this essential feature.",
      });
    }
  }

  const highValueFeatures = manifest.features.filter((f) => f.priority === "high_value");
  const highValueCovered = highValueFeatures.filter((f) => coveredFeatureIds.has(f.id));
  for (const feature of highValueFeatures) {
    if (!coveredFeatureIds.has(feature.id)) {
      unresolvedItems.push({
        kind: "high_value_feature",
        id: feature.id,
        reason: "No compiled task references this high-value feature.",
      });
    }
  }

  const requiredAcceptanceCriteria = essentialFeatures.flatMap((f) =>
    f.acceptanceCriteria.filter((ac) => ac.required).map((ac) => ({ feature: f, criterion: ac })),
  );
  const coveredAcceptanceCriteria = requiredAcceptanceCriteria.filter(({ criterion }) =>
    coveredAcceptanceCriteriaIds.has(criterion.id),
  );
  for (const { feature, criterion } of requiredAcceptanceCriteria) {
    if (!coveredAcceptanceCriteriaIds.has(criterion.id)) {
      unresolvedItems.push({
        kind: "acceptance_criterion",
        id: criterion.id,
        reason: `Acceptance criterion "${criterion.id}" on feature "${feature.id}" is not covered by any compiled task.`,
      });
    }
  }

  const requiredTestScenarios = essentialFeatures.flatMap((f) =>
    f.testScenarios.filter((ts) => ts.required).map((ts) => ({ feature: f, scenario: ts })),
  );
  const coveredTestScenarios = requiredTestScenarios.filter(({ feature }) => testCoveredFeatureIds.has(feature.id));
  for (const { feature, scenario } of requiredTestScenarios) {
    if (!testCoveredFeatureIds.has(feature.id)) {
      unresolvedItems.push({
        kind: "test_scenario",
        id: scenario.id,
        reason: `Test scenario "${scenario.id}" on feature "${feature.id}" has no task with a test verification check.`,
      });
    }
  }

  return {
    essentialFeaturesCovered: ratio(essentialCovered.length, essentialFeatures.length),
    highValueFeaturesCovered: ratio(highValueCovered.length, highValueFeatures.length),
    acceptanceCriteriaCovered: ratio(coveredAcceptanceCriteria.length, requiredAcceptanceCriteria.length),
    testScenariosCovered: ratio(coveredTestScenarios.length, requiredTestScenarios.length),
    unresolvedItems,
  };
}
