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
  DependencyService,
  EventService,
  LeaseService,
  ManifestValidationService,
  PolicyService,
  WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { runGit, WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { DeterministicTaskCompiler } from "@implementation-orchestrator/task-compiler";
import { createWorkflowProcessProcessor, type WorkflowProcessJobData } from "./workflow-process.js";
import { createWorkflowCompileProcessor, type WorkflowCompileJobData } from "./workflow-compile.js";
import { createWorkflowPrepareProcessor, type WorkflowPrepareJobData } from "./workflow-prepare.js";
import { createWorkflowScheduleProcessor, type WorkflowScheduleJobData } from "./workflow-schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

function fakeJob<T>(data: T): Job<T> {
  return { data } as Job<T>;
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
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-schedule-origin-"));
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

function manifestWithFrontendAndBackend(repositoryUrl: string) {
  const template = fixtureRichManifest().features[0]!;
  const backend = {
    ...template,
    id: "f-backend",
    name: "Backend API",
    summary: "Implement the backend API endpoint.",
    purpose: "Serve catalogue data over HTTP.",
    dependencies: [],
    acceptanceCriteria: [{ id: "ac1", criterion: "API responds with 200", measurement: "Integration test" }],
    testScenarios: [{ id: "ts1", name: "API integration test", given: "A running service", when: "A request is sent", then: "A 200 response is returned", kind: "integration" as const }],
  };
  const frontend = {
    ...template,
    id: "f-frontend",
    name: "Frontend Page",
    summary: "Build the UI page component.",
    purpose: "Display data to the user.",
    dependencies: ["f-backend"],
    acceptanceCriteria: [{ id: "ac2", criterion: "Page renders data", measurement: "Manual QA" }],
    testScenarios: [{ id: "ts2", name: "Page renders correctly", given: "Backend data is available", when: "The page loads", then: "The data is displayed", kind: "unit" as const }],
  };

  return {
    name: "Schedule Test Workflow",
    manifest: fixtureRichManifest({
      manifestId: "m-schedule",
      features: [backend, frontend],
      scope: {
        classifications: [
          { itemId: "f-backend", itemName: "Backend API", scopeClass: "essential", rationale: "Core.", cheaperAlternative: null, isSignatureElement: false },
          { itemId: "f-frontend", itemName: "Frontend Page", scopeClass: "essential", rationale: "Core.", cheaperAlternative: null, isSignatureElement: false },
        ],
        minimumCompleteProduct: ["f-backend", "f-frontend"],
        recommendedFirstRelease: ["f-backend", "f-frontend"],
        premiumRelease: [],
        experiments: [],
        deferredItems: [],
        rejectedItems: [],
        sequencingRationale: ["Backend ships before frontend."],
        scopeRisks: [],
      },
      implementationPlan: {
        ...fixtureRichManifest().implementationPlan,
        phases: [{ id: "p1", name: "Phase One", goal: "Ship backend and frontend", includedFeatureIds: ["f-backend", "f-frontend"], exitCriteria: ["Both features work end to end"] }],
      },
    }),
    repository: { url: repositoryUrl, baseBranch: "main" },
    policyProfile: "default-safe",
    builderProfile: "openhands-local",
  };
}

describe("workflow.schedule pipeline (Testcontainers Postgres + real git fixtures)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let workflowService: WorkflowService;
  let eventService: EventService;
  let dependencyService: DependencyService;
  let leaseService: LeaseService;
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
    dependencyService = new DependencyService(prisma);
    leaseService = new LeaseService(prisma);
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "io-schedule-workspaces-"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("runs the full pipeline from creation through leasing the first runnable task", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithFrontendAndBackend(originPath));
    const workflowId = summary.workflowId;

    const processProcessor = createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await processProcessor(fakeJob<WorkflowProcessJobData>({ workflowId }));

    const compileProcessor = createWorkflowCompileProcessor({
      workflowService,
      eventService,
      policyService: new PolicyService(),
      compiler: new DeterministicTaskCompiler(),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await compileProcessor(fakeJob<WorkflowCompileJobData>({ workflowId }));

    const prepareProcessor = createWorkflowPrepareProcessor({
      workflowService,
      dependencyService,
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await prepareProcessor(fakeJob<WorkflowPrepareJobData>({ workflowId }));

    const updatedAfterPrepare = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    expect(updatedAfterPrepare.status).toBe("running");

    const tasksAfterPrepare = await prisma.task.findMany({ where: { workflowId } });
    const statusByExternalId = new Map(tasksAfterPrepare.map((t) => [t.externalTaskId, t.status]));
    expect(statusByExternalId.get("setup.dependencies")).toBe("ready");
    expect(statusByExternalId.get("feature.f-backend")).toBe("blocked");
    expect(statusByExternalId.get("feature.f-frontend")).toBe("blocked");
    expect(statusByExternalId.get("integration.cross-boundary")).toBe("blocked");
    expect(statusByExternalId.get("verification.final")).toBe("blocked");

    const scheduleProcessor = createWorkflowScheduleProcessor({
      prisma,
      policyService: new PolicyService(),
      leaseService,
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await scheduleProcessor(fakeJob<WorkflowScheduleJobData>({ workflowId }));

    const tasksAfterSchedule = await prisma.task.findMany({ where: { workflowId } });
    const setupTask = tasksAfterSchedule.find((t) => t.externalTaskId === "setup.dependencies")!;
    expect(setupTask.status).toBe("leased");

    const otherTasksStillBlocked = tasksAfterSchedule.filter((t) => t.externalTaskId !== "setup.dependencies");
    expect(otherTasksStillBlocked.every((t) => t.status === "blocked")).toBe(true);

    const activeLeases = await prisma.taskLease.findMany({ where: { taskId: setupTask.id, status: "active" } });
    expect(activeLeases).toHaveLength(1);
    expect(activeLeases[0]?.builderId).toBe("openhands-local");

    const events = await eventService.listForWorkflow(workflowId);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toEqual(expect.arrayContaining(["workflow.running"]));

    await rm(originPath, { recursive: true, force: true });
  });

  it("does not schedule anything for a workflow that is not running", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithFrontendAndBackend(originPath));

    const scheduleProcessor = createWorkflowScheduleProcessor({
      prisma,
      policyService: new PolicyService(),
      leaseService,
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await expect(
      scheduleProcessor(fakeJob<WorkflowScheduleJobData>({ workflowId: summary.workflowId })),
    ).resolves.toBeUndefined();

    const leases = await prisma.taskLease.findMany({ where: { task: { workflowId: summary.workflowId } } });
    expect(leases).toHaveLength(0);

    await rm(originPath, { recursive: true, force: true });
  });
});
