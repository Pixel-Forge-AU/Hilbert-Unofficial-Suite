import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { DEFAULT_SAFE_POLICY, type ExecutionPolicy } from "@implementation-orchestrator/contracts";
import { TaskService, InvalidTaskTransitionError } from "./task-service.js";
import { DependencyService } from "./dependency-service.js";
import { LeaseService, TaskNotReadyError, LeaseAlreadyActiveError } from "./lease-service.js";
import { WorkflowService } from "./workflow-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

async function createFixtureWorkflow(prisma: PrismaClient): Promise<string> {
  const workflow = await prisma.workflow.create({
    data: {
      name: "Scheduling Fixture",
      status: "running",
      manifestVersion: "1.0",
      manifestHash: nextId("hash"),
      manifestJson: {},
      repositoryConfigJson: { url: "/tmp/fixture", baseBranch: "main" },
      policyProfileId: "default-safe",
      builderProfileId: "openhands-local",
    },
  });
  return workflow.id;
}

async function createFixtureTask(
  prisma: PrismaClient,
  workflowId: string,
  overrides: Partial<{ status: string; priority: string; phaseOrder: number }> = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      workflowId,
      externalTaskId: nextId("ext"),
      status: (overrides.status ?? "pending") as never,
      phaseId: "p1",
      phaseOrder: overrides.phaseOrder ?? 0,
      title: "Fixture Task",
      objective: "Do fixture work",
      category: "backend",
      priority: overrides.priority ?? "normal",
      builderProfile: "openhands-local",
      contractJson: {},
    },
  });
  return task.id;
}

async function createHardDependency(
  prisma: PrismaClient,
  workflowId: string,
  fromTaskId: string,
  toTaskId: string,
): Promise<void> {
  await prisma.taskDependency.create({
    data: { workflowId, fromTaskId, toTaskId, dependencyType: "hard", reason: "test" },
  });
}

describe("scheduling services (Testcontainers Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let taskService: TaskService;
  let workflowService: WorkflowService;
  let dependencyService: DependencyService;
  let leaseService: LeaseService;

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
    workflowService = new WorkflowService(prisma);
    dependencyService = new DependencyService(prisma);
    leaseService = new LeaseService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    idCounter += 1000;
  });

  describe("TaskService.transitionTask", () => {
    it("applies a valid transition and stamps the corresponding timestamp", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId);

      await taskService.transitionTask(taskId, "ready");

      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(row.status).toBe("ready");
      expect(row.readyAt).not.toBeNull();
    });

    it("rejects an invalid transition", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId);

      await expect(taskService.transitionTask(taskId, "accepted")).rejects.toThrow(InvalidTaskTransitionError);
    });

    it("is a no-op when already at the target status", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });

      await expect(taskService.transitionTask(taskId, "ready")).resolves.toBeUndefined();
    });
  });

  describe("DependencyService", () => {
    it("marks zero-dependency tasks ready and dependent tasks blocked on initial readiness", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const setupTask = await createFixtureTask(prisma, workflowId);
      const dependentTask = await createFixtureTask(prisma, workflowId);
      await createHardDependency(prisma, workflowId, dependentTask, setupTask);

      await dependencyService.computeInitialReadiness(workflowId);

      const setupRow = await prisma.task.findUniqueOrThrow({ where: { id: setupTask } });
      const dependentRow = await prisma.task.findUniqueOrThrow({ where: { id: dependentTask } });
      expect(setupRow.status).toBe("ready");
      expect(dependentRow.status).toBe("blocked");
    });

    it("unblocks a dependent task only once all its hard dependencies are accepted", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const depA = await createFixtureTask(prisma, workflowId, { status: "accepted" });
      const depB = await createFixtureTask(prisma, workflowId, { status: "pending" });
      const dependent = await createFixtureTask(prisma, workflowId, { status: "blocked" });
      await createHardDependency(prisma, workflowId, dependent, depA);
      await createHardDependency(prisma, workflowId, dependent, depB);

      await dependencyService.recheckAfterAcceptance(workflowId, depA);
      let dependentRow = await prisma.task.findUniqueOrThrow({ where: { id: dependent } });
      expect(dependentRow.status).toBe("blocked");

      await prisma.task.update({ where: { id: depB }, data: { status: "accepted" } });
      await dependencyService.recheckAfterAcceptance(workflowId, depB);
      dependentRow = await prisma.task.findUniqueOrThrow({ where: { id: dependent } });
      expect(dependentRow.status).toBe("ready");
    });
  });

  describe("LeaseService", () => {
    it("acquires a lease for a ready task and transitions it to leased", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });

      const lease = await leaseService.acquireLease(taskId, "builder-1", 900);

      expect(lease.taskId).toBe(taskId);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(row.status).toBe("leased");
    });

    it("refuses to lease a task that is not ready", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "pending" });

      await expect(leaseService.acquireLease(taskId, "builder-1", 900)).rejects.toThrow(TaskNotReadyError);
    });

    it("refuses to double-lease the same task", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });

      await leaseService.acquireLease(taskId, "builder-1", 900);
      await prisma.task.update({ where: { id: taskId }, data: { status: "ready" } });

      await expect(leaseService.acquireLease(taskId, "builder-2", 900)).rejects.toThrow(LeaseAlreadyActiveError);
    });

    it("supports heartbeat and release", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });
      const lease = await leaseService.acquireLease(taskId, "builder-1", 900);

      expect(await leaseService.heartbeat(lease.id)).toBe(true);
      expect(await leaseService.release(lease.id)).toBe(true);
      expect(await leaseService.heartbeat(lease.id)).toBe(false);
    });

    it("detects an expired lease", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });
      const lease = await leaseService.acquireLease(taskId, "builder-1", -1);

      const expired = await leaseService.findExpiredActiveLeases();
      expect(expired.some((e) => e.leaseId === lease.id)).toBe(true);

      expect(await leaseService.markExpired(lease.id)).toBe(true);
      expect(await leaseService.markExpired(lease.id)).toBe(false);
    });
  });

  describe("WorkflowService.evaluateFailureAfterTaskFailure", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_SAFE_POLICY, globalRetryBudget: 2 };

    it("fails the workflow when an essential task terminally fails", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready", priority: "essential" });
      await taskService.transitionTask(taskId, "leased");
      await taskService.transitionTask(taskId, "running");
      await taskService.transitionTask(taskId, "failed");

      await workflowService.evaluateFailureAfterTaskFailure(taskId, policy);

      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("failed");
      expect(workflow.failureCode).toBe("essential_task_failed");
    });

    it("does not fail the workflow when a low-priority task fails within retry budget", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready", priority: "low" });
      await taskService.transitionTask(taskId, "leased");
      await taskService.transitionTask(taskId, "running");
      await taskService.transitionTask(taskId, "failed");

      await workflowService.evaluateFailureAfterTaskFailure(taskId, policy);

      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("running");
    });

    it("fails the workflow when a low-priority task failure pushes the global retry budget over its limit", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const budgetConsumingTaskId = await createFixtureTask(prisma, workflowId, { priority: "low" });
      for (let i = 0; i < policy.globalRetryBudget; i += 1) {
        await prisma.taskAttempt.create({
          data: {
            taskId: budgetConsumingTaskId,
            attemptNumber: i + 1,
            attemptType: "retry",
            status: "failed",
          },
        });
      }

      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready", priority: "low" });
      await taskService.transitionTask(taskId, "leased");
      await taskService.transitionTask(taskId, "running");
      await taskService.transitionTask(taskId, "failed");

      await workflowService.evaluateFailureAfterTaskFailure(taskId, policy);

      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("failed");
      expect(workflow.failureCode).toBe("global_retry_budget_exceeded");
    });

    it("is a no-op once the workflow is already terminal", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready", priority: "essential" });
      await taskService.transitionTask(taskId, "leased");
      await taskService.transitionTask(taskId, "running");
      await taskService.transitionTask(taskId, "failed");

      await workflowService.evaluateFailureAfterTaskFailure(taskId, policy);
      await expect(workflowService.evaluateFailureAfterTaskFailure(taskId, policy)).resolves.toBeNull();
    });
  });

  describe("WorkflowService.evaluateCompletionAfterTaskAcceptance", () => {
    it("returns null and leaves the workflow running when a task is not yet terminal", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      await createFixtureTask(prisma, workflowId, { status: "ready" });

      const summary = await workflowService.evaluateCompletionAfterTaskAcceptance(workflowId);

      expect(summary).toBeNull();
      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("running");
    });

    it("returns null when an active lease remains even though every task is terminal", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "accepted" });
      await prisma.taskLease.create({
        data: { taskId, builderId: "builder-1", status: "active", acquiredAt: new Date(), expiresAt: new Date() },
      });

      const summary = await workflowService.evaluateCompletionAfterTaskAcceptance(workflowId);

      expect(summary).toBeNull();
    });

    it("returns null when the workflow has no tasks", async () => {
      const workflowId = await createFixtureWorkflow(prisma);

      await expect(workflowService.evaluateCompletionAfterTaskAcceptance(workflowId)).resolves.toBeNull();
    });

    it("marks the workflow completed and persists a summary once all tasks are terminal with no active leases", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      await createFixtureTask(prisma, workflowId, { status: "accepted" });
      await createFixtureTask(prisma, workflowId, { status: "accepted", priority: "low" });
      const failedOptional = await createFixtureTask(prisma, workflowId, { status: "ready", priority: "low" });
      await taskService.transitionTask(failedOptional, "leased");
      await taskService.transitionTask(failedOptional, "running");
      await taskService.transitionTask(failedOptional, "failed");

      const summary = await workflowService.evaluateCompletionAfterTaskAcceptance(workflowId);

      expect(summary).not.toBeNull();
      expect(summary?.status).toBe("completed");
      expect(summary?.acceptedTasks).toBe(2);
      expect(summary?.failedOptionalTasks).toBe(1);
      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("completed");
      expect(workflow.completedAt).not.toBeNull();
      expect(workflow.completionSummaryJson).not.toBeNull();
    });

    it("is a no-op once the workflow is already terminal", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      await createFixtureTask(prisma, workflowId, { status: "accepted" });
      await workflowService.evaluateCompletionAfterTaskAcceptance(workflowId);

      await expect(workflowService.evaluateCompletionAfterTaskAcceptance(workflowId)).resolves.toBeNull();
    });
  });

  describe("WorkflowService.cancel", () => {
    it("transitions the workflow to cancelled and cancels non-terminal, non-running tasks", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const readyTask = await createFixtureTask(prisma, workflowId, { status: "ready" });
      const pendingTask = await createFixtureTask(prisma, workflowId, { status: "pending" });
      const acceptedTask = await createFixtureTask(prisma, workflowId, { status: "accepted" });

      await workflowService.cancel(workflowId);

      const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
      expect(workflow.status).toBe("cancelled");
      expect((await prisma.task.findUniqueOrThrow({ where: { id: readyTask } })).status).toBe("cancelled");
      expect((await prisma.task.findUniqueOrThrow({ where: { id: pendingTask } })).status).toBe("cancelled");
      expect((await prisma.task.findUniqueOrThrow({ where: { id: acceptedTask } })).status).toBe("accepted");
    });

    it("leaves a running task untouched so the dispatcher can cooperatively cancel it", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const runningTask = await createFixtureTask(prisma, workflowId, { status: "ready" });
      await taskService.transitionTask(runningTask, "leased");
      await taskService.transitionTask(runningTask, "running");

      await workflowService.cancel(workflowId);

      const row = await prisma.task.findUniqueOrThrow({ where: { id: runningTask } });
      expect(row.status).toBe("running");
    });

    it("marks active leases as cancelled", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      const taskId = await createFixtureTask(prisma, workflowId, { status: "ready" });
      const lease = await leaseService.acquireLease(taskId, "builder-1", 900);

      await workflowService.cancel(workflowId);

      const leaseRow = await prisma.taskLease.findUniqueOrThrow({ where: { id: lease.id } });
      expect(leaseRow.status).toBe("cancelled");
      expect(leaseRow.releasedAt).not.toBeNull();
    });

    it("is a no-op once the workflow is already terminal", async () => {
      const workflowId = await createFixtureWorkflow(prisma);
      await workflowService.cancel(workflowId);
      const lateTaskId = await createFixtureTask(prisma, workflowId, { status: "pending" });

      await workflowService.cancel(workflowId);

      const row = await prisma.task.findUniqueOrThrow({ where: { id: lateTaskId } });
      expect(row.status).toBe("pending");
    });
  });
});
