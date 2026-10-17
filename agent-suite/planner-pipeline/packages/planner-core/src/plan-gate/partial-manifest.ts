import { MANIFEST_VERSION, type BuildManifest, type CompilerSynthesis, type ProjectDefinition, type StageOutputByName } from "@planner/contracts";

/**
 * Builds a BuildManifest-shaped object from whatever stage outputs exist so far, so plan_gate
 * rules whose earliestStage has already been reached can run against real data instead of
 * waiting for compileBuildManifest, which requires specification_compiler and validates the
 * full schema. Sections not yet produced are filled with empty-but-shape-safe defaults: every
 * plan_gate rule only ever reads the specific subpaths its earliestStage guarantees exist (see
 * early-checks.ts), so an empty default for a not-yet-produced section is indistinguishable
 * from "nothing to flag yet" for any rule that's actually eligible at a given checkpoint.
 *
 * Deliberately NOT validated against buildManifestSchema (compileBuildManifest's approach) -
 * this is an internal, partial view used only to drive ReferenceIndex and rule evaluation, and
 * is never persisted or returned as a real manifest.
 */
export function buildPartialManifest(project: ProjectDefinition, outputs: Partial<StageOutputByName>): BuildManifest {
  const compiler = outputs.specification_compiler as CompilerSynthesis | undefined;
  return {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    project,
    productDirection: outputs.creative_director ?? { signatureFeatures: [] },
    users: outputs.intent_interpreter?.targetUsers ?? [],
    experiencePrinciples: compiler?.experiencePrinciples ?? [],
    journeys: outputs.ux_designer?.journeys ?? [],
    features: outputs.feature_expander?.features ?? [],
    designSystem: outputs.art_director ?? {},
    architecture: outputs.systems_architect ?? { architectureDecisions: [], modules: [] },
    edgeCases: outputs.edge_case_hunter ?? { findings: [] },
    scope: outputs.scope_challenger ?? { classifications: [] },
    implementationPlan: compiler?.implementationPlan ?? {
      phases: [],
      workstreams: [],
      dependencyGraph: [],
      proposedRepositoryStructure: [],
      fileResponsibilities: [],
      databaseChanges: [],
      apiBuildOrder: [],
      uiBuildOrder: [],
      testBuildOrder: [],
      releaseCheckpoints: []
    },
    qualityRequirements: compiler?.qualityRequirements ?? {},
    definitionOfDone: compiler?.definitionOfDone ?? [],
    unresolvedDecisions: compiler?.unresolvedDecisions ?? [],
    assumptions: outputs.intent_interpreter?.assumptions ?? [],
    traceability: compiler?.traceability ?? { entries: [], untracedItems: [] }
  } as BuildManifest;
}
