import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { RepositoryConfig } from "@implementation-orchestrator/contracts";
import { runGit } from "./git.js";

export class DirtyWorkingTreeError extends Error {
  constructor(workspacePath: string) {
    super(`Cloned repository has an unexpectedly dirty working tree: ${workspacePath}`);
    this.name = "DirtyWorkingTreeError";
  }
}

export interface PreparedWorkspace {
  workspacePath: string;
  workflowBranch: string;
  baseCommitSha: string;
}

export function workflowBranchName(workflowId: string): string {
  return `automation/${workflowId}`;
}

export async function getCurrentCommitSha(workspacePath: string): Promise<string> {
  const { stdout } = await runGit(["rev-parse", "HEAD"], workspacePath);
  return stdout.trim();
}

export class WorkspaceManager {
  constructor(private readonly workspaceRoot: string) {}

  async prepareWorkspace(workflowId: string, repository: RepositoryConfig): Promise<PreparedWorkspace> {
    await mkdir(this.workspaceRoot, { recursive: true });
    const workspacePath = path.join(this.workspaceRoot, workflowId);

    await runGit(["clone", "--origin", "origin", repository.url, workspacePath], this.workspaceRoot);
    await runGit(["checkout", repository.baseBranch], workspacePath);

    const { stdout: statusOutput } = await runGit(["status", "--porcelain"], workspacePath);
    if (statusOutput.trim().length > 0) {
      throw new DirtyWorkingTreeError(workspacePath);
    }

    const { stdout: shaOutput } = await runGit(["rev-parse", "HEAD"], workspacePath);
    const baseCommitSha = shaOutput.trim();

    const workflowBranch = workflowBranchName(workflowId);
    await runGit(["checkout", "-b", workflowBranch], workspacePath);

    return { workspacePath, workflowBranch, baseCommitSha };
  }

  async createTaskWorktree(workspacePath: string, taskId: string, fromBranch: string): Promise<string> {
    const worktreePath = path.join(path.dirname(workspacePath), `${path.basename(workspacePath)}-task-${taskId}`);
    await runGit(
      ["worktree", "add", "-b", `automation/task/${taskId}`, worktreePath, fromBranch],
      workspacePath,
    );
    return worktreePath;
  }

  async removeTaskWorktree(workspacePath: string, worktreePath: string): Promise<void> {
    await runGit(["worktree", "remove", "--force", worktreePath], workspacePath);
  }

  async cleanupWorkspace(workspacePath: string): Promise<void> {
    await rm(workspacePath, { recursive: true, force: true });
  }
}
