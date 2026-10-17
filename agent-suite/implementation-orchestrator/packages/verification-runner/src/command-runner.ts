import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import path from "node:path";

export class WorkingDirectoryOutsideWorkspaceError extends Error {
  constructor(workingDirectory: string, workspacePath: string) {
    super(`Working directory "${workingDirectory}" is outside the task workspace "${workspacePath}".`);
    this.name = "WorkingDirectoryOutsideWorkspaceError";
  }
}

export interface RunCommandOptions {
  command: string;
  workingDirectory: string;
  workspacePath: string;
  timeoutSeconds: number;
  environmentReferences: string[];
  maxOutputBytes?: number;
}

export interface CommandRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const BASE_ALLOWED_ENV_VARS = ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "SYSTEMROOT", "APPDATA", "LOCALAPPDATA"];

const SECRET_LIKE_ENV_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

function buildAllowedEnvironment(environmentReferences: string[]): NodeJS.ProcessEnv {
  const allowedNames = new Set([...BASE_ALLOWED_ENV_VARS, ...environmentReferences]);
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowedNames) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

function collectSecretValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && SECRET_LIKE_ENV_PATTERN.test(name)) {
      values.push(value);
    }
  }
  return values;
}

export function redactSecrets(text: string, secretValues: string[] = collectSecretValues()): string {
  let redacted = text;
  for (const secret of secretValues) {
    if (!secret) continue;
    redacted = redacted.split(secret).join("***REDACTED***");
  }
  return redacted;
}

function truncate(buffer: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(buffer, "utf8") <= maxBytes) {
    return { text: buffer, truncated: false };
  }
  return { text: `${buffer.slice(0, maxBytes)}\n...[truncated]`, truncated: true };
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // process already gone
      }
    }
  }
}

export async function runCommand(options: RunCommandOptions): Promise<CommandRunResult> {
  const resolvedWorkspace = path.resolve(options.workspacePath);
  const resolvedWorkingDirectory = path.resolve(options.workingDirectory);
  if (
    resolvedWorkingDirectory !== resolvedWorkspace &&
    !resolvedWorkingDirectory.startsWith(resolvedWorkspace + path.sep)
  ) {
    throw new WorkingDirectoryOutsideWorkspaceError(options.workingDirectory, options.workspacePath);
  }

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const env = buildAllowedEnvironment(options.environmentReferences);
  const secretValues = collectSecretValues();

  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(options.command, {
      cwd: resolvedWorkingDirectory,
      env,
      shell: true,
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        killProcessTree(child.pid);
      }
    }, options.timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!stdoutTruncated) {
        const result = truncate(stdout + chunk.toString("utf8"), maxOutputBytes);
        stdout = result.text;
        stdoutTruncated = result.truncated;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!stderrTruncated) {
        const result = truncate(stderr + chunk.toString("utf8"), maxOutputBytes);
        stderr = result.text;
        stderrTruncated = result.truncated;
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        stdout: redactSecrets(stdout, secretValues),
        stderr: redactSecrets(stderr, secretValues),
        truncated: stdoutTruncated || stderrTruncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
