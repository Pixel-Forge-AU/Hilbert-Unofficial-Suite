import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { fixtureRichManifest } from "@implementation-orchestrator/contracts";
import {
  EventService,
  ManifestValidationService,
  WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { runGit, WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { createWorkflowProcessProcessor, type WorkflowProcessJobData } from "./workflow-process.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

function fakeJob(data: WorkflowProcessJobData): Job<WorkflowProcessJobData> {
  return { data } as Job<WorkflowProcessJobData>;
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

async function createFixtureRepository(): Promise<string> {
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-onboarding-origin-"));
  await runGit(["init", "-b", "main"], originPath);
  await runGit(["config", "user.email", "test@example.com"], originPath);
  await runGit(["config", "user.name", "Test Fixture"], originPath);
  await writeFile(
    path.join(originPath, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { build: "tsc", test: "vitest run" } }, null, 2),
  );
  await runGit(["add", "."], originPath);
  await runGit(["commit", "-m", "initial commit"], originPath);
  return originPath;
}

function validManifest(repositoryUrl: string) {
  return {
    name: "Onboarding Test Workflow",
    manifest: fixtureRichManifest({ manifestId: "m-onboarding" }),
    repository: { url: repositoryUrl, baseBranch: "main" },
    policyProfile: "default-safe",
    builderProfile: "openhands-local",
  };
}

describe("workflow.process pipeline (Testcontainers Postgres + real git fixtures)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let workflowService: WorkflowService;
  let eventService: EventService;
  let workspaceRoot: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").withDatabase("orchestrator").start();
    const connectionUri = container.getConnectionUri();

    execSync("pnpm --filter @implementation-orchestrator/database exec prisma migrate deploy", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionUri },
      stdio: "inherit",
    });

    prisma = createPrismaClient(connectionUri);
    workflowService = new WorkflowService(prisma);
    eventService = new EventService(prisma);
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "io-onboarding-workspaces-"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("validates the manifest, clones the repository, inspects it, and advances the workflow to compiling_tasks", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(validManifest(originPath));

    const processor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });

    await processor(fakeJob({ workflowId: summary.workflowId }));

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("compiling_tasks");
    expect(updated.workflowBranch).toBe(`automation/${summary.workflowId}`);
    expect(updated.baseCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(updated.repositoryProfileJson).toBeTruthy();

    const events = await eventService.listForWorkflow(summary.workflowId);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "workflow.created",
        "workflow.manifest_validated",
        "workflow.repository_inspection_started",
        "workflow.repository_inspection_completed",
      ]),
    );

    await rm(originPath, { recursive: true, force: true });
  });

  it("is idempotent: reprocessing an already-advanced workflow is a safe no-op", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(validManifest(originPath));

    const processor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });

    await processor(fakeJob({ workflowId: summary.workflowId }));
    await expect(processor(fakeJob({ workflowId: summary.workflowId }))).resolves.toBeUndefined();

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("compiling_tasks");

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails the workflow with a manifest failure class when the manifest is invalid", async () => {
    const originPath = await createFixtureRepository();
    const request = validManifest(originPath);
    request.manifest.features = [];
    const summary = await workflowService.createWorkflow(request);

    const processor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });

    await processor(fakeJob({ workflowId: summary.workflowId }));

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("failed");
    expect(updated.failureCode).toBe("manifest_invalid");

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails the workflow with a manifest failure class when the plan gate decision is rejected", async () => {
    const originPath = await createFixtureRepository();
    const request = validManifest(originPath);
    request.manifest.planGate = {
      ...request.manifest.planGate,
      decision: "rejected",
      errorCount: 1,
      findings: [
        {
          id: "rule:1",
          ruleId: "rule",
          severity: "error",
          sectionPath: "features.F001",
          problem: "Something is wrong.",
          evidence: "evidence",
          requiredChange: "fix it",
          responsibleStage: "feature_expander",
          requiresAdjudication: false,
          adjudicationOutcome: null,
          adjudicationRationale: null,
        },
      ],
    };
    const summary = await workflowService.createWorkflow(request);

    const processor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });

    await processor(fakeJob({ workflowId: summary.workflowId }));

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("failed");
    expect(updated.failureCode).toBe("manifest_invalid");

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails the workflow with an environment failure class when the repository cannot be cloned", async () => {
    const summary = await workflowService.createWorkflow(
      validManifest(path.join(os.tmpdir(), "does-not-exist-repo")),
    );

    const processor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });

    await processor(fakeJob({ workflowId: summary.workflowId }));

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("failed");
    expect(updated.failureCode).toBe("repository_unavailable");
  });
});
