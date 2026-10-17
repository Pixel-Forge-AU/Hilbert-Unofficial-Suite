import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@implementation-orchestrator/workspace-manager";
import type { VerificationCheckDefinition } from "@implementation-orchestrator/contracts";
import { runGitCleanlinessCheck } from "./git-cleanliness.js";

const definition: VerificationCheckDefinition = {
  id: "git-cleanliness",
  type: "git_cleanliness",
  name: "Git working tree cleanliness",
  timeoutSeconds: 30,
  required: true,
  continueOnFailure: false,
  environmentReferences: [],
  expectedExitCodes: [0],
};

describe("runGitCleanlinessCheck", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "io-git-clean-"));
    await runGit(["init", "-b", "main"], repoPath);
    await runGit(["config", "user.email", "test@example.com"], repoPath);
    await runGit(["config", "user.name", "Test Fixture"], repoPath);
    await writeFile(path.join(repoPath, "README.md"), "# fixture\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "initial commit"], repoPath);
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("passes when the working tree is clean", async () => {
    const result = await runGitCleanlinessCheck(definition, repoPath);
    expect(result.passed).toBe(true);
  });

  it("fails when there are uncommitted changes", async () => {
    await writeFile(path.join(repoPath, "untracked.txt"), "dirty\n");
    const result = await runGitCleanlinessCheck(definition, repoPath);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("untracked.txt");
  });
});
