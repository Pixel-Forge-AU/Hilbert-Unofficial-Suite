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
import { createTaskVerifyProcessor, type TaskVerifyJobData } from "./task-verify.js";

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
  const originPath = await mkdtemp(path.join(os.tmpdir(), "io-verify-origin-"));
  await runGit(["init", "-b", "main"], originPath);
  await runGit(["config", "user.email", "test@example.com"], originPath);
  await runGit(["config", "user.name", "Test Fixture"], originPath);
  await writeFile(
    path.join(originPath, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        scripts: {
          build: `node -e "process.exit(0)"`,
          test: `node -e "process.exit(0)"`,
        },
      },
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
    name: "Verify Test Workflow",
    manifest: fixtureRichManifest({
      manifestId: "m-verify",
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
    builderProfile: "mock",
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
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
    verification: {
      checks: [
        {
          id: "always-fail",
          type: "custom_command",
          name: "always fail",
          command: `node -e "process.exit(1)"`,
          timeoutSeconds: 10,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    },
    execution: {
      maxBuilderAttempts: 3,
      maxRemediationCycles: 3,
      timeoutSeconds: 10,
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

describe("task.verify pipeline (Testcontainers Postgres + real git fixtures)", () => {
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
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "io-verify-workspaces-"));
    artifactService = new ArtifactService(prisma, await mkdtemp(path.join(os.tmpdir(), "io-artifacts-")));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("accepts a task once verification passes and unblocks its dependent", async () => {
    const originPath = await createFixtureRepository();
    const summary = await workflowService.createWorkflow(manifestWithFrontendAndBackend(originPath));
    const workflowId = summary.workflowId;

    await createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService: new ManifestValidationService(),
      workspaceManager: new WorkspaceManager(workspaceRoot),
      jobEnqueuer: makeFakeJobEnqueuer(),
    })(fakeJob<WorkflowProcessJobData>({ workflowId }));

    await createWorkflowCompileProcessor({
      workflowService,
      eventService,
      policyService: new PolicyService(),
      compiler: new DeterministicTaskCompiler(),
      jobEnqueuer: makeFakeJobEnqueuer(),
    })(fakeJob<WorkflowCompileJobData>({ workflowId }));

    await createWorkflowPrepareProcessor({
      workflowService,
      dependencyService,
      jobEnqueuer: makeFakeJobEnqueuer(),
    })(fakeJob<WorkflowPrepareJobData>({ workflowId }));

    const scheduleJobEnqueuer = makeFakeJobEnqueuer();
    await createWorkflowScheduleProcessor({
      prisma,
      policyService: new PolicyService(),
      leaseService,
      jobEnqueuer: scheduleJobEnqueuer,
    })(fakeJob<WorkflowScheduleJobData>({ workflowId }));

    const dispatchJob = scheduleJobEnqueuer.jobs.find((j) => j.name === "task.dispatch")!;
    const dispatchJobEnqueuer = makeFakeJobEnqueuer();
    await createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      leaseService,
      eventService,
      policyService: new PolicyService(),
      builderGateway: new BuilderGateway({ mock: new MockBuilderAdapter({ outcome: "completed" }) }),
      jobEnqueuer: dispatchJobEnqueuer,
      pollIntervalMs: 20,
    })(fakeJob<TaskDispatchJobData>(dispatchJob.data as TaskDispatchJobData));

    const verifyJob = dispatchJobEnqueuer.jobs.find((j) => j.name === "task.verify")!;
    expect(verifyJob).toBeDefined();

    const verifyJobEnqueuer = makeFakeJobEnqueuer();
    await createTaskVerifyProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      eventService,
      dependencyService,
      policyService: new PolicyService(),
      jobEnqueuer: verifyJobEnqueuer,
    })(fakeJob<TaskVerifyJobData>(verifyJob.data as TaskVerifyJobData));

    const setupTaskId = (verifyJob.data as TaskVerifyJobData).taskId;
    const setupTask = await prisma.task.findUniqueOrThrow({ where: { id: setupTaskId } });
    expect(setupTask.status).toBe("accepted");

    const verificationRuns = await prisma.verificationRun.findMany({ where: { taskId: setupTaskId } });
    expect(verificationRuns).toHaveLength(1);
    expect(verificationRuns[0]?.passed).toBe(true);

    const backendTask = await prisma.task.findFirstOrThrow({
      where: { workflowId, externalTaskId: "feature.f-backend" },
    });
    expect(backendTask.status).toBe("ready");

    const frontendTask = await prisma.task.findFirstOrThrow({
      where: { workflowId, externalTaskId: "feature.f-frontend" },
    });
    expect(frontendTask.status).toBe("blocked");

    expect(verifyJobEnqueuer.jobs.some((j) => j.name === "workflow.schedule")).toBe(true);

    await rm(originPath, { recursive: true, force: true });
  });

  it("passes through remediation_required and reactivates to ready with a remediation instruction when retries remain", async () => {
    const originPath = await createFixtureRepository();
    const workflow = await prisma.workflow.create({
      data: {
        name: "Verify Fail Fixture",
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

    const executableTask = fixtureExecutableTask({ id: nextId("task") });
    const taskRow = await prisma.task.create({
      data: {
        workflowId: workflow.id,
        externalTaskId: executableTask.id,
        status: "builder_completed",
        phaseId: "p1",
        title: executableTask.title,
        objective: executableTask.objective,
        category: executableTask.category,
        priority: executableTask.priority,
        builderProfile: "mock",
        contractJson: executableTask as object,
      },
    });
    await prisma.taskAttempt.create({
      data: {
        taskId: taskRow.id,
        attemptNumber: 1,
        attemptType: "initial",
        status: "builder_completed",
        builderId: "mock",
        startedAt: new Date(),
        completedAt: new Date(),
        builderResultJson: { independentBeforeSha: (await runGit(["rev-parse", "HEAD"], originPath)).stdout.trim() },
      },
    });

    const verifyJobEnqueuer = makeFakeJobEnqueuer();
    await createTaskVerifyProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      eventService,
      dependencyService,
      policyService: new PolicyService(),
      jobEnqueuer: verifyJobEnqueuer,
    })(fakeJob<TaskVerifyJobData>({ taskId: taskRow.id }));

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskRow.id } });
    expect(updated.status).toBe("ready");
    expect(updated.remediationInstructionJson).not.toBeNull();
    const instruction = updated.remediationInstructionJson as { failureClass: string; failedChecks: unknown[] };
    expect(instruction.failureClass).toBe("verification");
    expect(instruction.failedChecks.length).toBeGreaterThan(0);
    expect(verifyJobEnqueuer.jobs.some((j) => j.name === "workflow.schedule")).toBe(true);

    await rm(originPath, { recursive: true, force: true });
  });

  it("fails a task when verification fails and the retry budget is exhausted", async () => {
    const originPath = await createFixtureRepository();
    const workflow = await prisma.workflow.create({
      data: {
        name: "Verify Fail Exhausted Fixture",
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
      priority: "low",
      execution: { ...fixtureExecutableTask().execution, maxRemediationCycles: 1 },
    });
    const taskRow = await prisma.task.create({
      data: {
        workflowId: workflow.id,
        externalTaskId: executableTask.id,
        status: "builder_completed",
        phaseId: "p1",
        title: executableTask.title,
        objective: executableTask.objective,
        category: executableTask.category,
        priority: executableTask.priority,
        builderProfile: "mock",
        contractJson: executableTask as object,
      },
    });
    await prisma.taskAttempt.create({
      data: {
        taskId: taskRow.id,
        attemptNumber: 1,
        attemptType: "remediation",
        status: "builder_completed",
        builderId: "mock",
        startedAt: new Date(),
        completedAt: new Date(),
        builderResultJson: { independentBeforeSha: (await runGit(["rev-parse", "HEAD"], originPath)).stdout.trim() },
      },
    });

    await createTaskVerifyProcessor({
      prisma,
      taskService,
      workflowService,
      artifactService,
      eventService,
      dependencyService,
      policyService: new PolicyService(),
      jobEnqueuer: makeFakeJobEnqueuer(),
    })(fakeJob<TaskVerifyJobData>({ taskId: taskRow.id }));

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskRow.id } });
    expect(updated.status).toBe("failed");

    await rm(originPath, { recursive: true, force: true });
  });
});
