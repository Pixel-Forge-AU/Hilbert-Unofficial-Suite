import YAML from "yaml";
import {
  MANIFEST_VERSION,
  buildManifestSchema,
  type BuildManifest,
  type CompilerSynthesis,
  type ProjectDefinition,
  type StageOutputByName
} from "@planner/contracts";

export function compileBuildManifest(
  project: ProjectDefinition,
  outputs: Partial<StageOutputByName>
): BuildManifest {
  const compiler = outputs.specification_compiler as CompilerSynthesis | undefined;
  if (!compiler) {
    throw new Error("Cannot compile manifest without specification_compiler output.");
  }
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    project,
    productDirection: outputs.creative_director,
    users: outputs.intent_interpreter?.targetUsers,
    experiencePrinciples: compiler.experiencePrinciples,
    journeys: outputs.ux_designer?.journeys,
    features: outputs.feature_expander?.features,
    designSystem: outputs.art_director,
    architecture: outputs.systems_architect,
    edgeCases: outputs.edge_case_hunter,
    scope: outputs.scope_challenger,
    implementationPlan: compiler.implementationPlan,
    qualityRequirements: compiler.qualityRequirements,
    definitionOfDone: compiler.definitionOfDone,
    unresolvedDecisions: compiler.unresolvedDecisions,
    assumptions: outputs.intent_interpreter?.assumptions ?? [],
    traceability: compiler.traceability
  };
  return buildManifestSchema.parse(manifest);
}

export function manifestToMarkdown(manifest: BuildManifest): string {
  return [
    `# ${manifest.project.title}`,
    "",
    "## Objective",
    manifest.project.brief,
    "",
    "## Product Direction",
    manifest.productDirection.experienceThesis,
    "",
    "## Features",
    ...manifest.features.map((feature) => `- ${feature.id}: ${feature.name} - ${feature.summary}`),
    "",
    "## Implementation Phases",
    ...manifest.implementationPlan.phases.map((phase) => `- ${phase.id}: ${phase.name} - ${phase.goal}`),
    "",
    "## Definition Of Done",
    ...manifest.definitionOfDone.map((item) => `- ${item.id}: ${item.item}`)
  ].join("\n");
}

export function manifestToYaml(manifest: BuildManifest): string {
  return YAML.stringify(manifest);
}
