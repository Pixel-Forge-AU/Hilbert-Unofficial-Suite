import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@implementation-orchestrator/workspace-manager";
import type { TaskScope, VerificationCheckDefinition } from "@implementation-orchestrator/contracts";
import { runChangedFileScopeCheck } from "./changed-file-scope.js";

const definition: VerificationCheckDefinition = {
  id: "changed-file-scope",
  type: "changed_file_scope",
  name: "Changed files stay within task scope",
  timeoutSeconds: 30,
  required: true,
  continueOnFailure: false,
  environmentReferences: [],
  expectedExitCodes: [0],
};

const scope: TaskScope = {
  included: [],
  excluded: [],
  likelyFiles: [],
  allowedDirectories: ["src/routes"],
  forbiddenDirectories: ["infra"],
};

describe("runChangedFileScopeCheck", () => {
  let repoPath: string;
  let baseCommitSha: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "io-scope-check-"));
    await runGit(["init", "-b", "main"], repoPath);
    await runGit(["config", "user.email", "test@example.com"], repoPath);
    await runGit(["config", "user.name", "Test Fixture"], repoPath);
    await mkdir(path.join(repoPath, "src", "routes"), { recursive: true });
    await mkdir(path.join(repoPath, "infra"), { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# fixture\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "initial commit"], repoPath);
    const { stdout } = await runGit(["rev-parse", "HEAD"], repoPath);
    baseCommitSha = stdout.trim();
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("passes when all changes are within the allowed directories", async () => {
    await writeFile(path.join(repoPath, "src", "routes", "users.ts"), "export {};\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "add route"], repoPath);

    const result = await runChangedFileScopeCheck(definition, repoPath, baseCommitSha, scope);
    expect(result.passed).toBe(true);
    expect(result.summary).toContain("within the task's allowed scope");
  });

  it("warns but does not fail when a support file outside scope is changed", async () => {
    await writeFile(path.join(repoPath, "package.json"), '{"name":"fixture"}');
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "touch package.json"], repoPath);

    const result = await runChangedFileScopeCheck(definition, repoPath, baseCommitSha, scope);
    expect(result.passed).toBe(true);
    expect(result.summary).toContain("outside predicted scope");
  });

  it("fails when a forbidden directory is touched", async () => {
    await writeFile(path.join(repoPath, "infra", "prod.tf"), "resource {}\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "touch infra"], repoPath);

    const result = await runChangedFileScopeCheck(definition, repoPath, baseCommitSha, scope);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("forbidden paths");
  });

  it("fails when a secret-looking file is touched even if not explicitly forbidden", async () => {
    await writeFile(path.join(repoPath, ".env"), "SECRET=1\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "touch env file"], repoPath);

    const result = await runChangedFileScopeCheck(definition, repoPath, baseCommitSha, scope);
    expect(result.passed).toBe(false);
  });
});
