import { execSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { ArtifactService } from "./artifact-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

async function createFixtureWorkflow(prisma: PrismaClient): Promise<string> {
  const workflow = await prisma.workflow.create({
    data: {
      name: "Artifact Fixture",
      status: "running",
      manifestVersion: "1.0",
      manifestHash: `hash-${Date.now()}-${Math.random()}`,
      manifestJson: {},
      repositoryConfigJson: { url: "/tmp/fixture", baseBranch: "main" },
      policyProfileId: "default-safe",
      builderProfileId: "openhands-local",
    },
  });
  return workflow.id;
}

describe("ArtifactService (Testcontainers Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let artifactService: ArtifactService;
  let storageRoot: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").withDatabase("orchestrator").start();
    const connectionUri = container.getConnectionUri();

    execSync("pnpm --filter @implementation-orchestrator/database exec prisma migrate deploy", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionUri },
      stdio: "inherit",
    });

    prisma = createPrismaClient(connectionUri);
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "io-artifact-service-"));
    artifactService = new ArtifactService(prisma, storageRoot);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it("writes content-addressed JSON to the filesystem and records an Artifact row", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const data = { status: "completed", acceptedTasks: 3 };

    const reference = await artifactService.storeJson({ workflowId, artifactType: "workflow_summary", data });

    expect(reference.workflowId).toBe(workflowId);
    expect(reference.artifactType).toBe("workflow_summary");
    expect(reference.storageProvider).toBe("filesystem");

    const row = await prisma.artifact.findUniqueOrThrow({ where: { id: reference.id } });
    expect(row.contentHash).toBe(reference.contentHash);
    expect(row.sizeBytes).toBeGreaterThan(0);

    const fileContents = await readFile(path.join(storageRoot, row.storageKey), "utf8");
    expect(JSON.parse(fileContents)).toEqual(data);
  });

  it("produces the same content hash for identical data", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const data = { status: "failed", failureCode: "essential_task_failed" };

    const first = await artifactService.storeJson({ workflowId, artifactType: "workflow_summary", data });
    const second = await artifactService.storeJson({ workflowId, artifactType: "workflow_summary", data });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.storageKey).toBe(second.storageKey);
  });

  it("associates an artifact with a task and attempt when provided", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const task = await prisma.task.create({
      data: {
        workflowId,
        externalTaskId: `ext-${Date.now()}`,
        status: "accepted",
        phaseId: "p1",
        phaseOrder: 0,
        title: "Fixture Task",
        objective: "Do fixture work",
        category: "backend",
        priority: "normal",
        builderProfile: "openhands-local",
        contractJson: {},
      },
    });
    const attempt = await prisma.taskAttempt.create({
      data: { taskId: task.id, attemptNumber: 1, attemptType: "initial", status: "accepted" },
    });

    const reference = await artifactService.storeJson({
      workflowId,
      taskId: task.id,
      attemptId: attempt.id,
      artifactType: "verification_log",
      data: { passed: true },
    });

    expect(reference.taskId).toBe(task.id);
    expect(reference.attemptId).toBe(attempt.id);
  });
});
