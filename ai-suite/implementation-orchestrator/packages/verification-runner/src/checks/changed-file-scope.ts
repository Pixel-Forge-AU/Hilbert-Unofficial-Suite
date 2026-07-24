import { runGit } from "@implementation-orchestrator/workspace-manager";
import type {
  TaskScope,
  VerificationCheckDefinition,
  VerificationCheckResult,
} from "@implementation-orchestrator/contracts";

const SECRET_LIKE_FILENAME_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.(?!example$|sample$|template$|dist$))/i,
  /(^|\/)id_rsa(\.pub)?$/i,
  /\.pem$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)secrets?\.(json|ya?ml)$/i,
];

function normalizePattern(pattern: string): string {
  return pattern.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = normalizePattern(pattern);
  if (normalized === filePath) {
    return true;
  }
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}

function isForbidden(filePath: string, forbiddenDirectories: string[]): boolean {
  if (SECRET_LIKE_FILENAME_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return true;
  }
  return forbiddenDirectories.some((pattern) => matchesPattern(filePath, pattern));
}

function isInScope(filePath: string, scope: TaskScope): boolean {
  const patterns = [...scope.allowedDirectories, ...scope.likelyFiles, ...scope.included];
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

export async function collectChangedFiles(workspacePath: string, baseCommitSha: string): Promise<string[]> {
  const changed = new Set<string>();

  const { stdout: diffOutput } = await runGit(["diff", "--name-only", baseCommitSha, "HEAD"], workspacePath);
  for (const line of diffOutput.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      changed.add(trimmed);
    }
  }

  const { stdout: statusOutput } = await runGit(["status", "--porcelain"], workspacePath);
  for (const line of statusOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const filePath = trimmed.slice(3).trim();
    if (filePath) {
      changed.add(filePath);
    }
  }

  return [...changed];
}

export async function runChangedFileScopeCheck(
  definition: VerificationCheckDefinition,
  workspacePath: string,
  baseCommitSha: string,
  scope: TaskScope,
): Promise<VerificationCheckResult> {
  const startedAt = Date.now();
  const changedFiles = await collectChangedFiles(workspacePath, baseCommitSha);

  const forbiddenHits = changedFiles.filter((f) => isForbidden(f, scope.forbiddenDirectories));
  const outOfScopeHits = changedFiles.filter(
    (f) => !isForbidden(f, scope.forbiddenDirectories) && !isInScope(f, scope),
  );

  const outcome = forbiddenHits.length > 0 ? "fail" : outOfScopeHits.length > 0 ? "warning" : "pass";

  let summary: string;
  if (outcome === "fail") {
    summary = `Changed files touch forbidden paths: ${forbiddenHits.join(", ")}`;
  } else if (outcome === "warning") {
    summary = `Changed files outside predicted scope (allowed, not blocked): ${outOfScopeHits.join(", ")}`;
  } else {
    summary = `All ${changedFiles.length} changed file(s) are within the task's allowed scope.`;
  }

  return {
    checkId: definition.id,
    type: definition.type,
    name: definition.name,
    passed: outcome !== "fail",
    required: definition.required,
    exitCode: outcome === "fail" ? 1 : 0,
    durationMs: Date.now() - startedAt,
    summary,
  };
}
