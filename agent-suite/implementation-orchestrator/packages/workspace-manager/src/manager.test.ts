import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./git.js";
import { WorkspaceManager, workflowBranchName } from "./manager.js";

async function createFixtureRepository(): Promise<{ originPath: string; headSha: string }> {
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-origin-"));
  await runGit(["init", "-b", "main"], originPath);
  await runGit(["config", "user.email", "test@example.com"], originPath);
  await runGit(["config", "user.name", "Test Fixture"], originPath);
  await writeFile(path.join(originPath, "README.md"), "# fixture repo\n");
  await runGit(["add", "."], originPath);
  await runGit(["commit", "-m", "initial commit"], originPath);
  const { stdout } = await runGit(["rev-parse", "HEAD"], originPath);
  return { originPath, headSha: stdout.trim() };
}

describe("WorkspaceManager", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "io-workspace-root-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("clones the repository, checks out the base branch, and creates a workflow branch", async () => {
    const { originPath, headSha } = await createFixtureRepository();
    const manager = new WorkspaceManager(path.join(tempRoot, "workspaces"));

    const result = await manager.prepareWorkspace("wf-test-1", {
      url: originPath,
      baseBranch: "main",
    });

    expect(result.baseCommitSha).toBe(headSha);
    expect(result.workflowBranch).toBe(workflowBranchName("wf-test-1"));

    const { stdout: currentBranch } = await runGit(["branch", "--show-current"], result.workspacePath);
    expect(currentBranch.trim()).toBe("automation/wf-test-1");

    const readme = await stat(path.join(result.workspacePath, "README.md"));
    expect(readme.isFile()).toBe(true);

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails with a git error when the base branch does not exist", async () => {
    const { originPath } = await createFixtureRepository();
    const manager = new WorkspaceManager(path.join(tempRoot, "workspaces"));

    await expect(
      manager.prepareWorkspace("wf-test-2", { url: originPath, baseBranch: "does-not-exist" }),
    ).rejects.toThrow(/does-not-exist/);

    await rm(originPath, { recursive: true, force: true });
  });

  it("creates and removes an isolated task worktree", async () => {
    const { originPath } = await createFixtureRepository();
    const manager = new WorkspaceManager(path.join(tempRoot, "workspaces"));
    const prepared = await manager.prepareWorkspace("wf-test-3", { url: originPath, baseBranch: "main" });

    const worktreePath = await manager.createTaskWorktree(prepared.workspacePath, "task-1", prepared.workflowBranch);
    const worktreeStat = await stat(worktreePath);
    expect(worktreeStat.isDirectory()).toBe(true);

    await manager.removeTaskWorktree(prepared.workspacePath, worktreePath);
    await expect(stat(worktreePath)).rejects.toThrow();

    await rm(originPath, { recursive: true, force: true });
  });

  it("cleans up the workspace directory", async () => {
    const { originPath } = await createFixtureRepository();
    const manager = new WorkspaceManager(path.join(tempRoot, "workspaces"));
    const prepared = await manager.prepareWorkspace("wf-test-4", { url: originPath, baseBranch: "main" });

    await manager.cleanupWorkspace(prepared.workspacePath);
    await expect(stat(prepared.workspacePath)).rejects.toThrow();

    await rm(originPath, { recursive: true, force: true });
  });
});
