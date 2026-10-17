import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@implementation-orchestrator/workspace-manager";
import { inspectRepository } from "./inspector.js";

describe("inspectRepository", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "io-inspect-"));
    await runGit(["init", "-b", "main"], repoPath);
    await runGit(["config", "user.email", "test@example.com"], repoPath);
    await runGit(["config", "user.name", "Test Fixture"], repoPath);

    await writeFile(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "fixture-app",
          scripts: {
            build: "tsc -b",
            test: "vitest run",
            lint: "eslint .",
            typecheck: "tsc -b --noEmit",
            start: "node dist/server.js",
          },
          dependencies: { fastify: "^5.0.0", pg: "^8.0.0" },
          devDependencies: { vitest: "^2.0.0", typescript: "^5.0.0" },
        },
        null,
        2,
      ),
    );
    await writeFile(path.join(repoPath, "tsconfig.json"), "{}");
    await writeFile(path.join(repoPath, ".env.example"), "DATABASE_URL=\n");
    await mkdir(path.join(repoPath, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(repoPath, ".github", "workflows", "ci.yml"), "name: CI\n");
    await mkdir(path.join(repoPath, "src"), { recursive: true });
    await writeFile(path.join(repoPath, "src", "index.ts"), "export {};\n");

    await runGit(["add", "."], repoPath);
    await runGit(["commit", "-m", "fixture commit"], repoPath);
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("assembles a repository profile from deterministic filesystem and git facts", async () => {
    const profile = await inspectRepository(repoPath, { url: repoPath, baseBranch: "main" });

    expect(profile.cleanWorkingTree).toBe(true);
    expect(profile.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(profile.languages.map((l) => l.name)).toContain("TypeScript/JavaScript");
    expect(profile.frameworks.map((f) => f.name)).toEqual(expect.arrayContaining(["Fastify"]));
    expect(profile.buildCommands).toHaveLength(1);
    expect(profile.testCommands).toHaveLength(1);
    expect(profile.lintCommands).toHaveLength(1);
    expect(profile.typecheckCommands).toHaveLength(1);
    expect(profile.startCommands).toHaveLength(1);
    expect(profile.databaseSystems).toContain("postgresql");
    expect(profile.ciSystems.map((c) => c.name)).toContain("GitHub Actions");
    expect(profile.environmentFiles).toContain(".env.example");
    expect(profile.directories.map((d) => d.path)).toContain("src");
    expect(profile.risks).toHaveLength(0);
    expect(profile.unknowns).toHaveLength(0);
  });

  it("flags a dirty working tree and missing build/test commands as risks", async () => {
    await rm(path.join(repoPath, "package.json"));
    await writeFile(path.join(repoPath, "untracked.txt"), "dirty\n");

    const profile = await inspectRepository(repoPath, { url: repoPath, baseBranch: "main" });

    expect(profile.cleanWorkingTree).toBe(false);
    const riskCodes = profile.risks.map((risk) => risk.code);
    expect(riskCodes).toEqual(
      expect.arrayContaining(["dirty_working_tree", "no_test_command", "no_build_command"]),
    );
  });
});
