import { execFile } from "node:child_process";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export class GitCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`);
    this.name = "GitCommandError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export function runGit(args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : null;
          reject(new GitCommandError(args, exitCode, stdout, stderr));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
