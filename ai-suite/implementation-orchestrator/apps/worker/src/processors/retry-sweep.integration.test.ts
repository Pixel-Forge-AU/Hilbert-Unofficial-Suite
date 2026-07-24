import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { TaskService } from "@implementation-orchestrator/orchestrator-core";
import { createRetrySweepProcessor } from "./retry-sweep.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeFakeJobEnqueuer() {
  const jobs: Array<{ name: string; data: unknown; jobId: string }> = [];
  return {
    jobs,
    enqueue: async (name: string, data: unknown, jobId: string) => {
      jobs.push({ name, data, jobId });
    },
  };
}

async function createFixtureWorkflow(prisma: PrismaClient): Promise<string> {
  const workflow = await prisma.workflow.create({
    data: {
      name: "Retry Sweep Fixture",
      status: "running",
      manifestVersion: "1.0",
      manifestHash: nextId("hash"),
      manifestJson: {},
      repositoryConfigJson: { url: "/tmp/fixture", baseBranch: "main" },
      policyProfileId: "default-safe",
      builderProfileId: "mock",
    },
  });
  return workflow.id;
}

async function createFixtureTask(
  prisma: PrismaClient,
  workflowId: string,
  overrides: Partial<{ status: string; retryEligibleAt: Date | null }> = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      workflowId,
      externalTaskId: nextId("ext"),
      status: (overrides.status ?? "retry_scheduled") as never,
      phaseId: "p1",
      title: "Fixture Task",
      objective: "Do fixture work",
      category: "backend",
      priority: "normal",
      builderProfile: "mock",
      contractJson: {},
      retryEligibleAt: overrides.retryEligibleAt,
    },
  });
  return task.id;
}

describe("retry.sweep (Testcontainers Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let taskService: TaskService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").withDatabase("orchestrator").start();
    const connectionUri = container.getConnectionUri();

    execSync("pnpm --filter @implementation-orchestrator/database exec prisma migrate deploy", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionUri },
      stdio: "inherit",
    });

    prisma = createPrismaClient(connectionUri);
    taskService = new TaskService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it("reactivates a task whose retry backoff has already elapsed", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const taskId = await createFixtureTask(prisma, workflowId, {
      retryEligibleAt: new Date(Date.now() - 1000),
    });

    const jobEnqueuer = makeFakeJobEnqueuer();
    await createRetrySweepProcessor({ prisma, taskService, jobEnqueuer })();

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(updated.status).toBe("ready");
    expect(updated.retryEligibleAt).toBeNull();
    expect(jobEnqueuer.jobs.some((j) => j.name === "workflow.schedule" && (j.data as { workflowId: string }).workflowId === workflowId)).toBe(true);
  });

  it("leaves a task alone whose retry backoff has not elapsed yet", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const taskId = await createFixtureTask(prisma, workflowId, {
      retryEligibleAt: new Date(Date.now() + 60_000),
    });

    const jobEnqueuer = makeFakeJobEnqueuer();
    await createRetrySweepProcessor({ prisma, taskService, jobEnqueuer })();

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(updated.status).toBe("retry_scheduled");
  });

  it("enqueues workflow.schedule once per distinct workflow even with multiple eligible tasks", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    await createFixtureTask(prisma, workflowId, { retryEligibleAt: new Date(Date.now() - 1000) });
    await createFixtureTask(prisma, workflowId, { retryEligibleAt: new Date(Date.now() - 1000) });

    const jobEnqueuer = makeFakeJobEnqueuer();
    await createRetrySweepProcessor({ prisma, taskService, jobEnqueuer })();

    const scheduleJobs = jobEnqueuer.jobs.filter(
      (j) => j.name === "workflow.schedule" && (j.data as { workflowId: string }).workflowId === workflowId,
    );
    expect(scheduleJobs).toHaveLength(1);
  });

  it("ignores tasks that are not in retry_scheduled status even if retryEligibleAt is in the past", async () => {
    const workflowId = await createFixtureWorkflow(prisma);
    const taskId = await createFixtureTask(prisma, workflowId, {
      status: "ready",
      retryEligibleAt: new Date(Date.now() - 1000),
    });

    const jobEnqueuer = makeFakeJobEnqueuer();
    await createRetrySweepProcessor({ prisma, taskService, jobEnqueuer })();

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(updated.status).toBe("ready");
  });
});
