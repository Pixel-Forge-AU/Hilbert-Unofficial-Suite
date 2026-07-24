import type { BuildManifest } from "@planner/contracts";

export type PlanGateReferenceType =
  | "feature"
  | "journey"
  | "architectureDecision"
  | "acceptanceCriterion"
  | "testScenario"
  | "phase"
  | "databaseChange"
  | "scopeItem"
  | "dependencyGraphLabel";

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export class ReferenceIndex {
  private readonly buckets: Record<PlanGateReferenceType, Set<string>>;

  constructor(manifest: BuildManifest) {
    const features = new Set(manifest.features.map((feature) => feature.id));
    const journeys = new Set(manifest.journeys.map((journey) => journey.id));
    const architectureDecisions = new Set(
      manifest.architecture.architectureDecisions.map((decision) => decision.id)
    );
    const acceptanceCriteria = new Set(
      manifest.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => criterion.id))
    );
    const testScenarios = new Set(
      manifest.features.flatMap((feature) => feature.testScenarios.map((scenario) => scenario.id))
    );
    const phases = new Set(manifest.implementationPlan.phases.map((phase) => phase.id));
    const databaseChanges = new Set(
      manifest.implementationPlan.databaseChanges.map((change) => change.id)
    );
    const scopeItems = new Set([
      ...features,
      ...manifest.productDirection.signatureFeatures.map((feature) => feature.id)
    ]);
    const dependencyGraphLabel = new Set(
      [
        ...manifest.architecture.modules.map((module) => module.name),
        ...manifest.architecture.modules.flatMap((module) => module.dependsOn),
        ...manifest.implementationPlan.workstreams.map((workstream) => workstream.name),
        ...manifest.implementationPlan.phases.map((phase) => phase.name),
        ...manifest.implementationPlan.phases.map((phase) => phase.id),
        ...manifest.features.map((feature) => feature.name),
        ...manifest.features.map((feature) => feature.id)
      ].map(normalizeLabel)
    );

    this.buckets = {
      feature: features,
      journey: journeys,
      architectureDecision: architectureDecisions,
      acceptanceCriterion: acceptanceCriteria,
      testScenario: testScenarios,
      phase: phases,
      databaseChange: databaseChanges,
      scopeItem: scopeItems,
      dependencyGraphLabel
    };
  }

  has(type: PlanGateReferenceType, id: string): boolean {
    if (type === "dependencyGraphLabel") return this.buckets.dependencyGraphLabel.has(normalizeLabel(id));
    return this.buckets[type].has(id);
  }
}
