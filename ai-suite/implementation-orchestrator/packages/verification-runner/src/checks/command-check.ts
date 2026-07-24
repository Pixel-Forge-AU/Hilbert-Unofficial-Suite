import type { VerificationCheckDefinition, VerificationCheckResult } from "@implementation-orchestrator/contracts";
import { runCommand } from "../command-runner.js";

export class MissingCommandError extends Error {
  constructor(checkId: string) {
    super(`Verification check "${checkId}" has no command to run.`);
    this.name = "MissingCommandError";
  }
}

export async function runGenericCommandCheck(
  definition: VerificationCheckDefinition,
  workspacePath: string,
): Promise<VerificationCheckResult> {
  if (!definition.command) {
    throw new MissingCommandError(definition.id);
  }

  const result = await runCommand({
    command: definition.command,
    workingDirectory: definition.workingDirectory ?? workspacePath,
    workspacePath,
    timeoutSeconds: definition.timeoutSeconds,
    environmentReferences: definition.environmentReferences,
  });

  const passed = !result.timedOut && result.exitCode !== null && definition.expectedExitCodes.includes(result.exitCode);

  const summaryParts = [
    result.timedOut
      ? `Command timed out after ${definition.timeoutSeconds}s.`
      : `Exit code ${result.exitCode}.`,
  ];
  if (!passed && result.stderr.trim()) {
    summaryParts.push(result.stderr.trim().slice(-2000));
  } else if (!passed && result.stdout.trim()) {
    summaryParts.push(result.stdout.trim().slice(-2000));
  }

  return {
    checkId: definition.id,
    type: definition.type,
    name: definition.name,
    passed,
    required: definition.required,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: summaryParts.join(" "),
  };
}
