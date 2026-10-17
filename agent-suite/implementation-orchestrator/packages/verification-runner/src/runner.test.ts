import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@implementation-orchestrator/workspace-manager";
import type { TaskScope, TaskVerificationPlan } from "@implementation-orchestrator/contracts";
import { VerificationRunner } from "./runner.js";

const scope: TaskScope = {
  included: [],
  excluded: [],
  likelyFiles: [],
  allowedDirectories: [],
  forbiddenDirectories: [],
};

describe("VerificationRunner", () => {
  let repoPath: string;
  let baseCommitSha: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "io-verify-runner-"));
    await runGit(["init", "-b", "main"], repoPath);
    await runGit(["config", "user.email", "test@example.com"], repoPath);
    await runGit(["config", "user.name", "Test Fixture"], repoPath);
    await writeFile(path.join(repoPath, "README.md"), "# fixture\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "initial commit"], repoPath);
    const { stdout } = await runGit(["rev-parse", "HEAD"], repoPath);
    baseCommitSha = stdout.trim();
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("passes overall when every check passes", async () => {
    await writeFile(path.join(repoPath, "src.ts"), "export {};\n");
    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "add file"], repoPath);

    const plan: TaskVerificationPlan = {
      checks: [
        {
          id: "git-cleanliness",
          type: "git_cleanliness",
          name: "clean",
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
        {
          id: "build",
          type: "build",
          name: "build",
          command: `node -e "process.exit(0)"`,
          workingDirectory: repoPath,
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    };

    const runner = new VerificationRunner();
    const result = await runner.run({
      taskId: "task-1",
      attemptId: "attempt-1",
      workspacePath: repoPath,
      baseCommitSha,
      scope,
      verificationPlan: plan,
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(2);
  });

  it("stops after a required, non-continuing check fails and reports overall failure", async () => {
    const plan: TaskVerificationPlan = {
      checks: [
        {
          id: "build",
          type: "build",
          name: "build",
          command: `node -e "process.exit(1)"`,
          workingDirectory: repoPath,
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
        {
          id: "unit-test",
          type: "unit_test",
          name: "test",
          command: `node -e "process.exit(0)"`,
          workingDirectory: repoPath,
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    };

    const runner = new VerificationRunner();
    const result = await runner.run({
      taskId: "task-1",
      attemptId: "attempt-1",
      workspacePath: repoPath,
      baseCommitSha,
      scope,
      verificationPlan: plan,
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.passed).toBe(false);
  });

  it("continues past a failing check when continueOnFailure is true", async () => {
    const plan: TaskVerificationPlan = {
      checks: [
        {
          id: "lint",
          type: "lint",
          name: "lint",
          command: `node -e "process.exit(1)"`,
          workingDirectory: repoPath,
          timeoutSeconds: 30,
          required: false,
          continueOnFailure: true,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
        {
          id: "unit-test",
          type: "unit_test",
          name: "test",
          command: `node -e "process.exit(0)"`,
          workingDirectory: repoPath,
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    };

    const runner = new VerificationRunner();
    const result = await runner.run({
      taskId: "task-1",
      attemptId: "attempt-1",
      workspacePath: repoPath,
      baseCommitSha,
      scope,
      verificationPlan: plan,
    });

    expect(result.checks).toHaveLength(2);
    expect(result.passed).toBe(true);
  });
});
