import type {
  TaskScope,
  TaskVerificationPlan,
  VerificationCheckResult,
  VerificationResult,
} from "@implementation-orchestrator/contracts";
import { runGitCleanlinessCheck } from "./checks/git-cleanliness.js";
import { runChangedFileScopeCheck } from "./checks/changed-file-scope.js";
import { runGenericCommandCheck } from "./checks/command-check.js";
import { computeOverallPassed } from "./result-normalizer.js";

export interface VerificationRunnerInput {
  taskId: string;
  attemptId: string;
  workspacePath: string;
  baseCommitSha: string;
  scope: TaskScope;
  verificationPlan: TaskVerificationPlan;
}

export class VerificationRunner {
  async run(input: VerificationRunnerInput): Promise<VerificationResult> {
    const startedAt = new Date().toISOString();
    const checks: VerificationCheckResult[] = [];

    for (const definition of input.verificationPlan.checks) {
      const result = await this.runSingleCheck(definition, input);
      checks.push(result);

      if (!result.passed && !definition.continueOnFailure) {
        break;
      }
    }

    return {
      taskId: input.taskId,
      attemptId: input.attemptId,
      passed: computeOverallPassed(checks, input.verificationPlan.passPolicy),
      checks,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  private async runSingleCheck(
    definition: VerificationRunnerInput["verificationPlan"]["checks"][number],
    input: VerificationRunnerInput,
  ): Promise<VerificationCheckResult> {
    switch (definition.type) {
      case "git_cleanliness":
        return runGitCleanlinessCheck(definition, input.workspacePath);
      case "changed_file_scope":
        return runChangedFileScopeCheck(definition, input.workspacePath, input.baseCommitSha, input.scope);
      default:
        return runGenericCommandCheck(definition, input.workspacePath);
    }
  }
}
