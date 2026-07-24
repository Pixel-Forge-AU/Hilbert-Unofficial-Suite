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
  PolicyService,
  WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { runGit, WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { DeterministicTaskCompiler } from "@implementation-orchestrator/task-compiler";
import { createWorkflowProcessProcessor, type WorkflowProcessJobData } from "./workflow-process.js";
import { createWorkflowCompileProcessor, type WorkflowCompileJobData } from "./workflow-compile.js";

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
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-compile-origin-"));
  await runGit(["init", "-b", "main"], originPath);
  await runGit(["config", "user.email", "test@example.com"], originPath);
  await runGit(["config", "user.name", "Test Fixture"], originPath);
  await writeFile(
    path.join(originPath, "package.json"),
    JSON.stringify(
      { name: "fixture", scripts: { build: "tsc", test: "vitest run", lint: "eslint ." } },
      null,
      2,
    ),
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
    name: "Compile Test Workflow",
    manifest: fixtureRichManifest({
      manifestId: "m-compile",
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

describe("workflow.compile pipeline (Testcontainers Postgres + real git fixtures)", () => {
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
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "io-compile-workspaces-"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function runProcessThenCompile(workflowId: string) {
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
  }

  it("compiles, validates, and persists the task graph, then advances the workflow to preparing_workspace", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithFrontendAndBackend(originPath));

    await runProcessThenCompile(summary.workflowId);

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("preparing_workspace");

    const tasks = await prisma.task.findMany({ where: { workflowId: summary.workflowId } });
    const externalIds = tasks.map((t) => t.externalTaskId).sort();
    expect(externalIds).toEqual(
      [
        "setup.dependencies",
        "feature.f-backend",
        "feature.f-frontend",
        "integration.cross-boundary",
        "verification.final",
      ].sort(),
    );
    expect(tasks.every((t) => t.status === "pending")).toBe(true);

    const dependencies = await prisma.taskDependency.findMany({ where: { workflowId: summary.workflowId } });
    expect(dependencies.length).toBeGreaterThan(0);

    const taskById = new Map(tasks.map((t) => [t.id, t.externalTaskId]));
    for (const dep of dependencies) {
      expect(taskById.has(dep.fromTaskId)).toBe(true);
      expect(taskById.has(dep.toTaskId)).toBe(true);
    }

    const finalTask = tasks.find((t) => t.externalTaskId === "verification.final")!;
    const finalTaskDeps = dependencies.filter((d) => d.fromTaskId === finalTask.id && d.dependencyType === "hard");
    expect(finalTaskDeps.length).toBe(tasks.length - 1);

    const events = await eventService.listForWorkflow(summary.workflowId);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["workflow.task_compilation_completed", "workflow.task_graph_validated"]),
    );

    await rm(originPath, { recursive: true, force: true });
  });

  it("is idempotent: reprocessing an already-compiled workflow does not duplicate tasks", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithFrontendAndBackend(originPath));

    await runProcessThenCompile(summary.workflowId);
    const firstCount = await prisma.task.count({ where: { workflowId: summary.workflowId } });

    const compileProcessor = createWorkflowCompileProcessor({
      workflowService,
      eventService,
      policyService: new PolicyService(),
      compiler: new DeterministicTaskCompiler(),
      jobEnqueuer: makeFakeJobEnqueuer(),
    });
    await compileProcessor(fakeJob<WorkflowCompileJobData>({ workflowId: summary.workflowId }));

    const secondCount = await prisma.task.count({ where: { workflowId: summary.workflowId } });
    expect(secondCount).toBe(firstCount);

    const updated = await prisma.workflow.findUniqueOrThrow({ where: { id: summary.workflowId } });
    expect(updated.status).toBe("preparing_workspace");

    await rm(originPath, { recursive: true, force: true });
  });
});
