import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function makeFakeQueue() {
  const jobs: Array<{ name: string; data: unknown }> = [];
  return {
    jobs,
    add: async (name: string, data: unknown) => {
      jobs.push({ name, data });
      return { id: "fake-job" } as never;
    },
    close: async () => {},
  };
}

describe("workflow API (Testcontainers Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let queue: ReturnType<typeof makeFakeQueue>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").withDatabase("orchestrator").start();
    const connectionUri = container.getConnectionUri();

    execSync("pnpm --filter @implementation-orchestrator/database exec prisma migrate deploy", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionUri },
      stdio: "inherit",
    });

    prisma = createPrismaClient(connectionUri);
    queue = makeFakeQueue();
    app = await buildApp({ prisma, jobQueue: queue, logger: false });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it("reports healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects an invalid workflow creation request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: { name: "" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("creates a workflow, persists the manifest hash, and enqueues its creation event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: {
        name: "Parts Library Build",
        manifest: { manifestId: "m1", manifestVersion: "1.0", features: [] },
        repository: { url: "git@github.com:example/project.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "openhands-local",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("created");
    expect(typeof body.workflowId).toBe("string");

    const stored = await prisma.workflow.findUniqueOrThrow({ where: { id: body.workflowId } });
    expect(stored.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.status).toBe("created");

    const events = await prisma.workflowEvent.findMany({ where: { workflowId: body.workflowId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("workflow.created");

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs.map((job) => job.name)).toEqual(
      expect.arrayContaining(["event.record", "workflow.process"]),
    );
  });

  it("returns 404 for an unknown workflow", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/workflows/does-not-exist" });
    expect(response.statusCode).toBe(404);
  });

  it("lists tasks for a workflow as empty before compilation", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: {
        name: "Second Workflow",
        manifest: { manifestId: "m2", manifestVersion: "1.0", features: [] },
        repository: { url: "git@github.com:example/project2.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "openhands-local",
      },
    });
    const { workflowId } = createResponse.json();

    const tasksResponse = await app.inject({ method: "GET", url: `/v1/workflows/${workflowId}/tasks` });
    expect(tasksResponse.statusCode).toBe(200);
    expect(tasksResponse.json()).toEqual([]);
  });

  it("exposes Prometheus metrics", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("orchestrator_workflows_total");
  });

  it("serves an OpenAPI document describing the workflow endpoints", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.openapi).toBe("3.0.3");
    expect(body.paths).toHaveProperty("/v1/workflows");
    expect(body.paths).toHaveProperty("/v1/workflows/{workflowId}/cancel");
  });

  it("cancels a running workflow and its non-terminal tasks", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: {
        name: "Cancellable Workflow",
        manifest: { manifestId: "m-cancel", manifestVersion: "1.0", features: [] },
        repository: { url: "git@github.com:example/project-cancel.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "openhands-local",
      },
    });
    const { workflowId } = createResponse.json();
    await prisma.workflow.update({ where: { id: workflowId }, data: { status: "running" } });
    const task = await prisma.task.create({
      data: {
        workflowId,
        externalTaskId: "cancel-ext-1",
        status: "ready",
        phaseId: "p1",
        phaseOrder: 0,
        title: "Cancel me",
        objective: "Do work",
        category: "backend",
        priority: "normal",
        builderProfile: "openhands-local",
        contractJson: {},
      },
    });

    const cancelResponse = await app.inject({ method: "POST", url: `/v1/workflows/${workflowId}/cancel` });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().status).toBe("cancelled");

    const taskRow = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskRow.status).toBe("cancelled");
  });

  it("returns 404 when cancelling an unknown workflow", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/workflows/does-not-exist/cancel" });
    expect(response.statusCode).toBe(404);
  });

  it("lists artifacts for a workflow as empty before any are stored", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      payload: {
        name: "Artifact-less Workflow",
        manifest: { manifestId: "m-artifacts", manifestVersion: "1.0", features: [] },
        repository: { url: "git@github.com:example/project-artifacts.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "openhands-local",
      },
    });
    const { workflowId } = createResponse.json();

    const response = await app.inject({ method: "GET", url: `/v1/workflows/${workflowId}/artifacts` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("processes duplicate event submissions idempotently", async () => {
    const duplicateEvent = {
      id: "idempotency-check-event",
      type: "task.created" as const,
      workflowId: (await prisma.workflow.findFirstOrThrow()).id,
      source: "test",
      payload: { note: "first" },
    };

    const first = await app.eventService.record(duplicateEvent);
    const second = await app.eventService.record({ ...duplicateEvent, payload: { note: "second" } });

    expect(first.wasNew).toBe(true);
    expect(second.wasNew).toBe(false);

    const rows = await prisma.workflowEvent.findMany({ where: { id: duplicateEvent.id } });
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payloadJson as { note: string }).note).toBe("first");
  });
});
