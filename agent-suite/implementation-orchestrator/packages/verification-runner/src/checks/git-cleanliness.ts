import { runGit } from "@implementation-orchestrator/workspace-manager";
import type { VerificationCheckDefinition, VerificationCheckResult } from "@implementation-orchestrator/contracts";

export async function runGitCleanlinessCheck(
  definition: VerificationCheckDefinition,
  workspacePath: string,
): Promise<VerificationCheckResult> {
  const startedAt = Date.now();
  const { stdout } = await runGit(["status", "--porcelain"], workspacePath);
  const isClean = stdout.trim().length === 0;

  return {
    checkId: definition.id,
    type: definition.type,
    name: definition.name,
    passed: isClean,
    required: definition.required,
    exitCode: isClean ? 0 : 1,
    durationMs: Date.now() - startedAt,
    summary: isClean
      ? "Working tree is clean."
      : `Working tree has uncommitted changes:\n${stdout.trim()}`,
  };
}
