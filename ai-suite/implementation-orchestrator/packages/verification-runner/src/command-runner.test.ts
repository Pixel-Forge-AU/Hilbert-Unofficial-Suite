import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand, redactSecrets, WorkingDirectoryOutsideWorkspaceError } from "./command-runner.js";

describe("runCommand", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), "io-cmd-runner-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("captures stdout and exit code for a successful command", async () => {
    const result = await runCommand({
      command: `node -e "console.log('hello from child')"`,
      workingDirectory: workspacePath,
      workspacePath,
      timeoutSeconds: 10,
      environmentReferences: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from child");
    expect(result.timedOut).toBe(false);
  });

  it("captures a non-zero exit code", async () => {
    const result = await runCommand({
      command: `node -e "process.exit(3)"`,
      workingDirectory: workspacePath,
      workspacePath,
      timeoutSeconds: 10,
      environmentReferences: [],
    });

    expect(result.exitCode).toBe(3);
  });

  it("kills a command that exceeds its timeout", async () => {
    const result = await runCommand({
      command: `node -e "setTimeout(() => {}, 5000)"`,
      workingDirectory: workspacePath,
      workspacePath,
      timeoutSeconds: 1,
      environmentReferences: [],
    });

    expect(result.timedOut).toBe(true);
  }, 8000);

  it("rejects a working directory outside the task workspace", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "io-cmd-runner-outside-"));
    await expect(
      runCommand({
        command: "node -e \"console.log('x')\"",
        workingDirectory: outside,
        workspacePath,
        timeoutSeconds: 5,
        environmentReferences: [],
      }),
    ).rejects.toThrow(WorkingDirectoryOutsideWorkspaceError);
    await rm(outside, { recursive: true, force: true });
  });

  it("does not expose non-allowlisted environment variables to the child process", async () => {
    process.env.IO_TEST_NOT_ALLOWED = "should-not-leak";
    try {
      const result = await runCommand({
        command: `node -e "console.log('value:' + (process.env.IO_TEST_NOT_ALLOWED ?? 'undefined'))"`,
        workingDirectory: workspacePath,
        workspacePath,
        timeoutSeconds: 10,
        environmentReferences: [],
      });
      expect(result.stdout).toContain("value:undefined");
    } finally {
      delete process.env.IO_TEST_NOT_ALLOWED;
    }
  });

  it("exposes an environment variable named in environmentReferences", async () => {
    process.env.IO_TEST_ALLOWED = "should-be-visible";
    try {
      const result = await runCommand({
        command: `node -e "console.log('value:' + process.env.IO_TEST_ALLOWED)"`,
        workingDirectory: workspacePath,
        workspacePath,
        timeoutSeconds: 10,
        environmentReferences: ["IO_TEST_ALLOWED"],
      });
      expect(result.stdout).toContain("value:should-be-visible");
    } finally {
      delete process.env.IO_TEST_ALLOWED;
    }
  });
});

describe("redactSecrets", () => {
  it("replaces occurrences of secret values in captured output", () => {
    const redacted = redactSecrets("the value is sekritvalue123456 in this log", ["sekritvalue123456"]);
    expect(redacted).toBe("the value is ***REDACTED*** in this log");
    expect(redacted).not.toContain("sekritvalue123456");
  });

  it("leaves output untouched when there are no secrets to redact", () => {
    expect(redactSecrets("nothing sensitive here", [])).toBe("nothing sensitive here");
  });
});
