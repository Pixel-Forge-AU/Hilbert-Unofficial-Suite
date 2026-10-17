import type {
  BuildManifest,
  CompilationFeaturePriority,
  CompilationManifest,
  ScopeClass,
} from "@implementation-orchestrator/contracts";

const PRIORITY_BY_SCOPE_CLASS: Record<ScopeClass, CompilationFeaturePriority> = {
  essential: "essential",
  high_value: "high_value",
  delight: "high_value",
  experimental: "optional",
  future: "optional",
  unnecessary: "optional",
};

/** Unclassified features (absent from scope.classifications) default here — compiled, but not held to the hardest gate. */
const DEFAULT_PRIORITY: CompilationFeaturePriority = "high_value";

function derivePriority(featureId: string, scopeClassByItemId: Map<string, ScopeClass>): CompilationFeaturePriority {
  const scopeClass = scopeClassByItemId.get(featureId);
  if (!scopeClass) return DEFAULT_PRIORITY;
  return PRIORITY_BY_SCOPE_CLASS[scopeClass];
}

/**
 * Projects the rich, wire-facing BuildManifest into the narrow CompilationManifest shape
 * @implementation-orchestrator/task-compiler consumes internally. Pure and deterministic —
 * called both by ManifestValidationService (to run cross-reference checks against the shape
 * task-compiler will actually see) and by the workflow.compile worker processor.
 */
export function deriveCompilationManifest(rich: BuildManifest): CompilationManifest {
  const scopeClassByItemId = new Map(rich.scope.classifications.map((c) => [c.itemId, c.scopeClass]));

  const features = rich.features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    description: `${feature.summary}\n\n${feature.purpose}`,
    priority: derivePriority(feature.id, scopeClassByItemId),
    dependsOn: feature.dependencies,
    acceptanceCriteria: feature.acceptanceCriteria.map((ac) => ({
      id: ac.id,
      description: `${ac.criterion} — measured by: ${ac.measurement}`,
      required: true,
    })),
    testScenarios: feature.testScenarios.map((ts) => ({
      id: ts.id,
      description: `${ts.name}: Given ${ts.given}, when ${ts.when}, then ${ts.then}.`,
      required: true,
    })),
  }));

  const phases = rich.implementationPlan.phases.map((phase, index) => ({
    id: phase.id,
    name: phase.name,
    description: phase.goal,
    order: index,
    featureIds: phase.includedFeatureIds,
    dependsOn: index > 0 ? [rich.implementationPlan.phases[index - 1]!.id] : [],
  }));

  return {
    manifestId: rich.manifestId,
    manifestVersion: rich.manifestVersion,
    name: rich.project.title,
    features,
    phases,
  };
}
