import type { ExecutableTask } from "@implementation-orchestrator/contracts";
import type { CompilerContext } from "./compiler-context.js";
import { buildScopeForCategory } from "./category-classifier.js";
import { buildExecutionPolicy, buildVerificationPlan } from "./verification-compiler.js";
import { normalizeTask } from "./task-normalizer.js";

export const INTEGRATION_TASK_ID = "integration.cross-boundary";
export const FINAL_VERIFICATION_TASK_ID = "verification.final";

const FRONTEND_LIKE = new Set(["frontend"]);
const BACKEND_LIKE = new Set(["backend", "api", "database"]);

export function compileIntegrationTask(context: CompilerContext, featureTasks: ExecutableTask[]): ExecutableTask | null {
  const frontendTasks = featureTasks.filter((t) => FRONTEND_LIKE.has(t.category));
  const backendTasks = featureTasks.filter((t) => BACKEND_LIKE.has(t.category));

  if (frontendTasks.length === 0 || backendTasks.length === 0) {
    return null;
  }

  const timeoutSeconds = context.policy.taskDefaults.timeoutSeconds;
  return normalizeTask({
    id: INTEGRATION_TASK_ID,
    sourceFeatureIds: [],
    sourceRequirementIds: [],
    sourceAcceptanceCriteriaIds: [],
    sourceTestScenarioIds: [],
    phaseId: "integration",
    title: "Verify frontend/backend integration",
    objective:
      "Confirm the frontend and backend implementations built in this workflow integrate correctly across the module boundary.",
    category: "integration",
    priority: "essential",
    builderProfile: context.defaultBuilderProfile,
    scope: buildScopeForCategory("integration", context.policy.forbiddenPaths),
    repositoryContext: {
      baseBranch: context.repository.baseBranch,
      workflowBranch: context.workflowBranch,
    },
    dependencies: [...frontendTasks, ...backendTasks].map((t) => t.id),
    acceptanceCriteria: [],
    verification: buildVerificationPlan("integration", context.repository, timeoutSeconds),
    execution: buildExecutionPolicy("integration", context.policy.taskDefaults),
    policyConstraints: [],
    expectedArtifacts: [{ type: "git_diff", required: false }],
    tags: ["integration"],
  });
}

export function compileFinalVerificationTask(context: CompilerContext, allOtherTaskIds: string[]): ExecutableTask {
  const timeoutSeconds = context.policy.taskDefaults.timeoutSeconds;
  return normalizeTask({
    id: FINAL_VERIFICATION_TASK_ID,
    sourceFeatureIds: [],
    sourceRequirementIds: [],
    sourceAcceptanceCriteriaIds: [],
    sourceTestScenarioIds: [],
    phaseId: "final-verification",
    title: "Final workflow verification",
    objective: "Re-run the full verification suite once after every other task has been accepted.",
    category: "verification",
    priority: "essential",
    builderProfile: context.defaultBuilderProfile,
    scope: buildScopeForCategory("verification", context.policy.forbiddenPaths),
    repositoryContext: {
      baseBranch: context.repository.baseBranch,
      workflowBranch: context.workflowBranch,
    },
    dependencies: allOtherTaskIds,
    acceptanceCriteria: [],
    verification: buildVerificationPlan("verification", context.repository, timeoutSeconds),
    execution: buildExecutionPolicy("verification", context.policy.taskDefaults),
    policyConstraints: [],
    expectedArtifacts: [],
    tags: ["final-verification"],
  });
}
