import type { ExecutableTask, CompilationFeature } from "@implementation-orchestrator/contracts";
import type { CompilerContext } from "./compiler-context.js";
import { buildScopeForCategory, classifyFeatureCategory } from "./category-classifier.js";
import { buildExecutionPolicy, buildVerificationPlan } from "./verification-compiler.js";
import { chunkAcceptanceCriteria } from "./task-splitter.js";
import { normalizeTask } from "./task-normalizer.js";

export const SETUP_TASK_ID = "setup.dependencies";
export const MIGRATION_TASK_ID = "setup.migrations";
export const UNPHASED_PHASE_ID = "unphased";

const PRIORITY_BY_MANIFEST_PRIORITY: Record<CompilationFeature["priority"], "essential" | "high"> = {
  essential: "essential",
  high_value: "high",
  optional: "high",
};

export function findFeaturePhaseId(context: CompilerContext, featureId: string): string {
  const phase = context.manifest.phases.find((p) => p.featureIds.includes(featureId));
  return phase?.id ?? UNPHASED_PHASE_ID;
}

export function compileSetupTasks(context: CompilerContext): ExecutableTask[] {
  const tasks: ExecutableTask[] = [];
  const timeoutSeconds = context.policy.taskDefaults.timeoutSeconds;

  tasks.push(
    normalizeTask({
      id: SETUP_TASK_ID,
      sourceFeatureIds: [],
      sourceRequirementIds: [],
      sourceAcceptanceCriteriaIds: [],
      sourceTestScenarioIds: [],
      phaseId: "setup",
      title: "Install project dependencies",
      objective: "Install project dependencies and confirm the toolchain runs cleanly on a fresh checkout.",
      category: "dependency",
      priority: "blocking",
      builderProfile: context.defaultBuilderProfile,
      scope: buildScopeForCategory("dependency", context.policy.forbiddenPaths),
      repositoryContext: {
        baseBranch: context.repository.baseBranch,
        workflowBranch: context.workflowBranch,
      },
      dependencies: [],
      acceptanceCriteria: [],
      verification: buildVerificationPlan("dependency", context.repository, timeoutSeconds),
      execution: buildExecutionPolicy("dependency", context.policy.taskDefaults),
      policyConstraints: [],
      expectedArtifacts: [{ type: "git_diff", required: false }],
      tags: ["setup"],
    }),
  );

  if (context.repository.migrationCommands.length > 0) {
    tasks.push(
      normalizeTask({
        id: MIGRATION_TASK_ID,
        sourceFeatureIds: [],
        sourceRequirementIds: [],
        sourceAcceptanceCriteriaIds: [],
        sourceTestScenarioIds: [],
        phaseId: "setup",
        title: "Apply database migrations",
        objective: "Apply and verify the repository's database migrations against a clean database.",
        category: "migration",
        priority: "blocking",
        builderProfile: context.defaultBuilderProfile,
        scope: buildScopeForCategory("migration", context.policy.forbiddenPaths),
        repositoryContext: {
          baseBranch: context.repository.baseBranch,
          workflowBranch: context.workflowBranch,
        },
        dependencies: [SETUP_TASK_ID],
        acceptanceCriteria: [],
        verification: buildVerificationPlan("migration", context.repository, timeoutSeconds),
        execution: buildExecutionPolicy("migration", context.policy.taskDefaults),
        policyConstraints: [],
        expectedArtifacts: [{ type: "git_diff", required: false }],
        tags: ["setup", "migration"],
      }),
    );
  }

  return tasks;
}

function compiledFeaturePriority(feature: CompilationFeature): "essential" | "high" {
  return PRIORITY_BY_MANIFEST_PRIORITY[feature.priority];
}

export function compileFeatureTasks(context: CompilerContext): ExecutableTask[] {
  const compilableFeatures = context.manifest.features.filter((f) => f.priority !== "optional");
  const timeoutSeconds = context.policy.taskDefaults.timeoutSeconds;
  const tasks: ExecutableTask[] = [];

  const chunksByFeatureId = new Map(
    compilableFeatures.map((feature) => [
      feature.id,
      chunkAcceptanceCriteria(feature.acceptanceCriteria, context.config.maxAcceptanceCriteriaPerTask),
    ]),
  );
  const finalTaskIdByFeatureId = new Map<string, string>();
  for (const feature of compilableFeatures) {
    const chunkCount = chunksByFeatureId.get(feature.id)!.length;
    const suffix = chunkCount > 1 ? `.part${chunkCount}` : "";
    finalTaskIdByFeatureId.set(feature.id, `feature.${feature.id}${suffix}`);
  }

  for (const feature of compilableFeatures) {
    const category = classifyFeatureCategory(feature);
    const phaseId = findFeaturePhaseId(context, feature.id);
    const priority = compiledFeaturePriority(feature);
    const chunks = chunksByFeatureId.get(feature.id)!;

    if (chunks.length > 1) {
      context.warn(
        "feature_split",
        `Feature "${feature.id}" exceeded ${context.config.maxAcceptanceCriteriaPerTask} acceptance criteria and was split into ${chunks.length} tasks.`,
        { featureId: feature.id },
      );
    }

    chunks.forEach((chunk, index) => {
      const partSuffix = chunks.length > 1 ? `.part${index + 1}` : "";
      const taskId = `feature.${feature.id}${partSuffix}`;
      const title = chunks.length > 1 ? `${feature.name} (part ${index + 1} of ${chunks.length})` : feature.name;
      const dependencies =
        index > 0
          ? [`feature.${feature.id}.part${index}`]
          : feature.dependsOn
              .map((depId) => finalTaskIdByFeatureId.get(depId))
              .filter((id): id is string => Boolean(id));

      tasks.push(
        normalizeTask({
          id: taskId,
          sourceFeatureIds: [feature.id],
          sourceRequirementIds: [],
          sourceAcceptanceCriteriaIds: chunk.map((ac) => ac.id),
          sourceTestScenarioIds: index === 0 ? feature.testScenarios.map((ts) => ts.id) : [],
          phaseId,
          title,
          objective: feature.description,
          category,
          priority,
          builderProfile: context.defaultBuilderProfile,
          scope: buildScopeForCategory(category, context.policy.forbiddenPaths),
          repositoryContext: {
            baseBranch: context.repository.baseBranch,
            workflowBranch: context.workflowBranch,
          },
          dependencies,
          acceptanceCriteria: chunk.map((ac) => ({
            id: ac.id,
            description: ac.description,
            sourceAcceptanceCriteriaId: ac.id,
          })),
          verification: buildVerificationPlan(category, context.repository, timeoutSeconds),
          execution: buildExecutionPolicy(category, context.policy.taskDefaults),
          policyConstraints: [],
          expectedArtifacts: [{ type: "git_diff", required: true }],
          tags: [feature.priority, category],
        }),
      );
    });
  }

  return tasks;
}
