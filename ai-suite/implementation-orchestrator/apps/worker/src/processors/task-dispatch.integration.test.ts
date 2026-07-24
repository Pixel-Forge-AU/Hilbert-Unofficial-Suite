import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { fixtureRichManifest, type ExecutableTask } from "@implementation-orchestrator/contracts";
import {
  ArtifactService,
  DependencyService,
  EventService,
  LeaseService,
  ManifestValidationService,
  PolicyService,
  TaskService,
  WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { runGit, WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { DeterministicTaskCompiler } from "@implementation-orchestrator/task-compiler";
import { BuilderGateway, MockBuilderAdapter } from "@implementation-orchestrator/builder-gateway";
import { createWorkflowProcessProcessor, type WorkflowProcessJobData } from "./workflow-process.js";
import { createWorkflowCompileProcessor, type WorkflowCompileJobData } from "./workflow-compile.js";
import { createWorkflowPrepareProcessor, type WorkflowPrepareJobData } from "./workflow-prepare.js";
import { createWorkflowScheduleProcessor, type WorkflowScheduleJobData } from "./workflow-schedule.js";
import { createTaskDispatchProcessor, type TaskDispatchJobData } from "./task-dispatch.js";

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
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-dispatch-origin-"));
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

function manifestWithSingleBackendFeature(repositoryUrl: string) {
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

  return {
    name: "Dispatch Test Workflow",
    manifest: fixtureRichManifest({
      manifestId: "m-dispatch",
      features: [backend],
      scope: {
        classifications: [
          { itemId: "f-backend", itemName: "Backend API", scopeClass: "essential", rationale: "Core.", cheaperAlternative: null, isSignatureElement: false },
        ],
        minimumCompleteProduct: ["f-backend"],
        recommendedFirstRelease: ["f-backend"],
        premiumRelease: [],
        experiments: [],
        deferredItems: [],
        rejectedItems: [],
        sequencingRationale: ["Backend ships first."],
        scopeRisks: [],
      },
      implementationPlan: {
        ...fixtureRichManifest().implementationPlan,
        phases: [{ id: "p1", name: "Phase One", goal: "Ship backend", includedFeatureIds: ["f-backend"], exitCriteria: ["Backend works end to end"] }],
      },
    }),
    repository: { url: repositoryUrl, baseBranch: "main" },
    policyProfile: "default-safe",
    builderProfile: "mock",
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function fixtureRepositoryProfile(): object {
  return {
    repositoryUrl: "/tmp/fixture-repo",
    baseBranch: "main",
    commitSha: "a".repeat(40),
    cleanWorkingTree: true,
    languages: [],
    frameworks: [],
    packageManagers: [],
    buildCommands: [],
    testCommands: [],
    lintCommands: [],
    typecheckCommands: [],
    migrationCommands: [],
    startCommands: [],
    directories: [],
    ciSystems: [],
    databaseSystems: [],
    environmentFiles: [],
    architectureMarkers: [],
    risks: [],
    unknowns: [],
  };
}

function fixtureExecutableTask(overrides: Partial<ExecutableTask> = {}): ExecutableTask {
  return {
    id: "fixture-task",
    sourceFeatureIds: [],
    sourceRequirementIds: [],
    sourceAcceptanceCriteriaIds: [],
    sourceTestScenarioIds: [],
    phaseId: "p1",
    title: "Fixture Task",
    objective: "Do fixture work",
    category: "backend",
    priority: "essential",
    builderProfile: "mock",
    scope: { included: [], excluded: [], likelyFiles: [], allowedDirectories: [], forbiddenDirectories: [] },
    repositoryContext: { baseBranch: "main", workflowBranch: "automation/wf" },
    dependencies: [],
    acceptanceCriteria: [],
    verification: { checks: [], requiredArtifactTypes: [], passPolicy: "all_required" },
    execution: {
      maxBuilderAttempts: 3,
      maxRemediationCycles: 3,
      timeoutSeconds: 5,
      heartbeatIntervalSeconds: 30,
      leaseDurationSeconds: 900,
      allowNetworkAccess: false,
      allowDependencyChanges: false,
      allowSchemaChanges: false,
      requireCommit: true,
    },
    policyConstraints: [],
    expectedArtifacts: [],
    tags: [],
    ...overrides,
  };
}

describe("task.dispatch pipeline (Testcontainers Postgres + real git fixtures)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let workflowService: WorkflowService;
  let taskService: TaskService;
  let eventService: EventService;
  let dependencyService: DependencyService;
  let leaseService: LeaseService;
  let workspaceRoot: string;
  let artifactService: ArtifactService;

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
    taskService = new TaskService(prisma);
    eventService = new EventService(prisma);
    dependencyService = new DependencyService(prisma);
    leaseService = new LeaseService(prisma);
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "io-dispatch-workspaces-"));
    artifactService = new ArtifactService(prisma, await mkdtemp(path.join(os.tmpdir(), "io-artifacts-")));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("runs the full pipeline from creation through a builder-completed task", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithSingleBackendFeature(originPath));
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

    const scheduleJobEnqueuer = makeFakeJobEnqueuer();
    const scheduleProcessor = createWorkflowScheduleProcessor({
      prisma,
      policyService: new PolicyService(),
      leaseService,
      jobEnqueuer: scheduleJobEnqueuer,
    });
    await scheduleProcessor(fakeJob<WorkflowScheduleJobData>({ workflowId }));

    const dispatchJob = scheduleJobEnqueuer.jobs.find((j) => j.name === "task.dispatch");
    expect(dispatchJob).toBeDefined();

    const mockAdapter = new MockBuilderAdapter({ outcome: "completed", changedFiles: ["src/index.ts"] });
    const dispatchProcessor = createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      leaseService,
      eventService,
      policyService: new PolicyService(),
      builderGateway: new BuilderGateway({ mock: mockAdapter }),
      jobEnqueuer: makeFakeJobEnqueuer(),
      pollIntervalMs: 20,
    });
    await dispatchProcessor(fakeJob<TaskDispatchJobData>(dispatchJob!.data as TaskDispatchJobData));

    const dispatchedTask = await prisma.task.findUniqueOrThrow({
      where: { id: (dispatchJob!.data as TaskDispatchJobData).taskId },
    });
    expect(dispatchedTask.status).toBe("builder_completed");

    const attempts = await prisma.taskAttempt.findMany({ where: { taskId: dispatchedTask.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attemptType).toBe("initial");
    expect(attempts[0]?.status).toBe("builder_completed");
    const builderResult = attempts[0]?.builderResultJson as { independentBeforeSha: string; independentAfterSha: string };
    expect(builderResult.independentBeforeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(builderResult.independentAfterSha).toBe(builderResult.independentBeforeSha);

    const activeLeases = await prisma.taskLease.findMany({ where: { taskId: dispatchedTask.id, status: "active" } });
    expect(activeLeases).toHaveLength(0);

    await rm(originPath, { recursive: true, force: true });
  });

  it("schedules a retry when the builder fails and attempt budget remains", async () => {
    const originPath = await createFixtureRepository();
    const workflow = await prisma.workflow.create({
      data: {
        name: "Retry Fixture",
        status: "running",
        manifestVersion: "1.0",
        manifestHash: nextId("hash"),
        manifestJson: {},
        repositoryConfigJson: { url: originPath, baseBranch: "main" },
        repositoryProfileJson: fixtureRepositoryProfile(),
        workspacePath: originPath,
        workflowBranch: "automation/fixture",
        policyProfileId: "default-safe",
        builderProfileId: "mock",
      },
    });

    const executableTask = fixtureExecutableTask({ id: nextId("task"), title: "Retry Task" });
    const taskRow = await prisma.task.create({
      data: {
        workflowId: workflow.id,
        externalTaskId: executableTask.id,
        status: "ready",
        phaseId: "p1",
        title: executableTask.title,
        objective: executableTask.objective,
        category: executableTask.category,
        priority: executableTask.priority,
        builderProfile: "mock",
        contractJson: executableTask as object,
      },
    });

    const lease = await leaseService.acquireLease(taskRow.id, "mock", 900);

    const mockAdapter = new MockBuilderAdapter();
    mockAdapter.setScriptForTask(executableTask.id, { outcome: "failed", failureMessage: "build broke" });
    const dispatchProcessor = createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      leaseService,
      eventService,
      policyService: new PolicyService(),
      builderGateway: new BuilderGateway({ mock: mockAdapter }),
      jobEnqueuer: makeFakeJobEnqueuer(),
      pollIntervalMs: 20,
    });
    await dispatchProcessor(fakeJob<TaskDispatchJobData>({ taskId: taskRow.id, leaseId: lease.id }));

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskRow.id } });
    expect(updated.status).toBe("retry_scheduled");
    expect(updated.retryEligibleAt).not.toBeNull();
    expect(updated.retryEligibleAt!.getTime()).toBeGreaterThan(Date.now());

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails the task once the builder attempt budget is exhausted", async () => {
    const originPath = await createFixtureRepository();
    const workflow = await prisma.workflow.create({
      data: {
        name: "Exhausted Retry Fixture",
        status: "running",
        manifestVersion: "1.0",
        manifestHash: nextId("hash"),
        manifestJson: {},
        repositoryConfigJson: { url: originPath, baseBranch: "main" },
        repositoryProfileJson: fixtureRepositoryProfile(),
        workspacePath: originPath,
        workflowBranch: "automation/fixture",
        policyProfileId: "default-safe",
        builderProfileId: "mock",
      },
    });

    const executableTask = fixtureExecutableTask({
      id: nextId("task"),
      title: "Exhausted Retry Task",
      execution: { ...fixtureExecutableTask().execution, maxBuilderAttempts: 1 },
    });
    const taskRow = await prisma.task.create({
      data: {
        workflowId: workflow.id,
        externalTaskId: executableTask.id,
        status: "ready",
        phaseId: "p1",
        title: executableTask.title,
        objective: executableTask.objective,
        category: executableTask.category,
        priority: executableTask.priority,
        builderProfile: "mock",
        contractJson: executableTask as object,
      },
    });

    const lease = await leaseService.acquireLease(taskRow.id, "mock", 900);

    const mockAdapter = new MockBuilderAdapter();
    mockAdapter.setScriptForTask(executableTask.id, { outcome: "failed", failureMessage: "build broke" });
    const dispatchProcessor = createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      leaseService,
      eventService,
      policyService: new PolicyService(),
      builderGateway: new BuilderGateway({ mock: mockAdapter }),
      jobEnqueuer: makeFakeJobEnqueuer(),
      pollIntervalMs: 20,
    });
    await dispatchProcessor(fakeJob<TaskDispatchJobData>({ taskId: taskRow.id, leaseId: lease.id }));

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskRow.id } });
    expect(updated.status).toBe("failed");

    const updatedWorkflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } });
    expect(updatedWorkflow.status).toBe("failed");
    expect(updatedWorkflow.failureCode).toBe("essential_task_failed");

    await rm(originPath, { recursive: true, force: true });
  });

  it("times out and fails a task that never reaches a terminal builder state", async () => {
    const originPath = await createFixtureRepository();
    const workflow = await prisma.workflow.create({
      data: {
        name: "Timeout Fixture",
        status: "running",
        manifestVersion: "1.0",
        manifestHash: nextId("hash"),
        manifestJson: {},
        repositoryConfigJson: { url: originPath, baseBranch: "main" },
        repositoryProfileJson: fixtureRepositoryProfile(),
        workspacePath: originPath,
        workflowBranch: "automation/fixture",
        policyProfileId: "default-safe",
        builderProfileId: "mock",
      },
    });

    const executableTask = fixtureExecutableTask({
      id: nextId("task"),
      title: "Timeout Task",
      execution: { ...fixtureExecutableTask().execution, timeoutSeconds: 1, maxBuilderAttempts: 1 },
    });
    const taskRow = await prisma.task.create({
      data: {
        workflowId: workflow.id,
        externalTaskId: executableTask.id,
        status: "ready",
        phaseId: "p1",
        title: executableTask.title,
        objective: executableTask.objective,
        category: executableTask.category,
        priority: executableTask.priority,
        builderProfile: "mock",
        contractJson: executableTask as object,
      },
    });

    const lease = await leaseService.acquireLease(taskRow.id, "mock", 900);

    const mockAdapter = new MockBuilderAdapter();
    mockAdapter.setScriptForTask(executableTask.id, { outcome: "completed", delayMs: 30_000 });
    const dispatchProcessor = createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      leaseService,
      eventService,
      policyService: new PolicyService(),
      builderGateway: new BuilderGateway({ mock: mockAdapter }),
      jobEnqueuer: makeFakeJobEnqueuer(),
      pollIntervalMs: 200,
    });
    await dispatchProcessor(fakeJob<TaskDispatchJobData>({ taskId: taskRow.id, leaseId: lease.id }));

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskRow.id } });
    expect(updated.status).toBe("failed");

    const attempt = await prisma.taskAttempt.findFirstOrThrow({ where: { taskId: taskRow.id } });
    expect(attempt.failureCode).toBe("builder_timeout");

    await rm(originPath, { recursive: true, force: true });
  }, 10_000);
});
