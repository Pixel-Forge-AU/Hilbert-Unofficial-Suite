import { runGit } from "@implementation-orchestrator/workspace-manager";

export interface GitFacts {
  commitSha: string;
  currentBranch: string;
  cleanWorkingTree: boolean;
}

export async function readGitFacts(workspacePath: string): Promise<GitFacts> {
  const [{ stdout: shaOutput }, { stdout: branchOutput }, { stdout: statusOutput }] = await Promise.all([
    runGit(["rev-parse", "HEAD"], workspacePath),
    runGit(["branch", "--show-current"], workspacePath),
    runGit(["status", "--porcelain"], workspacePath),
  ]);

  return {
    commitSha: shaOutput.trim(),
    currentBranch: branchOutput.trim(),
    cleanWorkingTree: statusOutput.trim().length === 0,
  };
}
