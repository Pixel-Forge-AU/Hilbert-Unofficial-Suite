import type { BuilderTaskRequest } from "@implementation-orchestrator/contracts";

export function buildTaskPrompt(request: BuilderTaskRequest): string {
  const { task } = request;
  const lines: string[] = [
    `Task: ${task.title}`,
    "",
    task.objective,
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion.description}`),
  ];

  if (task.scope.allowedDirectories.length > 0) {
    lines.push("", "Stay within these directories unless a change elsewhere is strictly necessary:");
    lines.push(...task.scope.allowedDirectories.map((dir) => `- ${dir}`));
  }

  if (request.remediationInstructions && request.remediationInstructions.length > 0) {
    lines.push("", "Address the following remediation feedback from a previous attempt:");
    for (const instruction of request.remediationInstructions) {
      lines.push(`- ${instruction.instruction}`);
      for (const check of instruction.failedChecks) {
        lines.push(`  - ${check.name}: ${check.summary}`);
      }
    }
  }

  lines.push(
    "",
    "Commit your changes when finished. Do not expand scope beyond what is described above.",
  );

  return lines.join("\n");
}
