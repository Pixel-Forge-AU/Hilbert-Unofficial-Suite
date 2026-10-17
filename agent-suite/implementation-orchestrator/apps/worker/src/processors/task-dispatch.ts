import type { Job } from "bullmq";
import { Prisma, type PrismaClient } from "@implementation-orchestrator/database";
import {
  BuilderTaskRequestSchema,
  ExecutableTaskSchema,
  RemediationInstructionSchema,
  type BuilderResult,
  type BuilderResultStatus,
  type ExecutableTask,
  type FailureClass,
  type RepositoryProfile,
  type TaskStatus,
} from "@implementation-orchestrator/contracts";
import {
  decideRetry,
  type ArtifactService,
  type EventService,
  type LeaseService,
  type PolicyService,
  type TaskService,
  type WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { isTerminalExecutionState, type BuilderGateway } from "@implementation-orchestrator/builder-gateway";
import { getCurrentCommitSha } from "@implementation-orchestrator/workspace-manager";
import { taskAttemptsTotal, taskDurationSeconds, tasksFailedTotal } from "@implementation-orchestrator/observability";
import type { JobEnqueuer } from "../job-enqueuer.js";
import { recordTerminalOutcome } from "../terminal-outcome.js";

export interface TaskDispatchJobData {
  taskId: string;
  leaseId: string;
}

export interface TaskDispatchDependencies {
  prisma: PrismaClient;
  taskService: TaskService;
  workflowService: WorkflowService;
  leaseService: LeaseService;
  eventService: EventService;
  policyService: PolicyService;
  artifactService: ArtifactService;
  builderGateway: BuilderGateway;
  jobEnqueuer: JobEnqueuer;
  pollIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RESULT_STATUS_TO_TASK_STATUS: Record<BuilderResultStatus, TaskStatus> = {
  completed: "builder_completed",
  failed: "failed",
  timed_out: "failed",
  cancelled: "cancelled",
};

export function createTaskDispatchProcessor(deps: TaskDispatchDependencies) {
  const pollIntervalMs = deps.pollIntervalMs ?? 2000;

  return async function processDispatch(job: Job<TaskDispatchJobData>): Promise<void> {
    const { taskId, leaseId } = job.data;

    const taskRow = await deps.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (taskRow.status !== "leased") {
      return;
    }

    const workflow = await deps.prisma.workflow.findUniqueOrThrow({ where: { id: taskRow.workflowId } });
    const executableTask = ExecutableTaskSchema.parse(taskRow.contractJson);
    const repositoryProfile = workflow.repositoryProfileJson as RepositoryProfile;
    const workspacePath = workflow.workspacePath!;

    const pendingRemediation = taskRow.remediationInstructionJson
      ? RemediationInstructionSchema.parse(taskRow.remediationInstructionJson)
      : null;
    if (pendingRemediation) {
      await deps.prisma.task.update({
        where: { id: taskId },
        data: { remediationInstructionJson: Prisma.JsonNull },
      });
    }

    const previousAttemptRows = await deps.prisma.taskAttempt.findMany({
      where: { taskId },
      orderBy: { attemptNumber: "asc" },
    });
    const attemptNumber = previousAttemptRows.length + 1;
    const attemptType = pendingRemediation ? "remediation" : attemptNumber === 1 ? "initial" : "retry";

    const attempt = await deps.prisma.taskAttempt.create({
      data: {
        taskId,
        attemptNumber,
        attemptType,
        status: "running",
        builderId: executableTask.builderProfile,
        startedAt: new Date(),
      },
    });

    taskAttemptsTotal.inc({ attempt_type: attemptType });
    await deps.taskService.transitionTask(taskId, "running", { type: "task.started" });

    const attemptStartedAt = Date.now();
    const beforeSha = await getCurrentCommitSha(workspacePath);

    const adapter = deps.builderGateway.resolve(executableTask.builderProfile);
    const session = await adapter.createSession({
      workflowId: workflow.id,
      workspacePath,
      builderProfile: executableTask.builderProfile,
    });

    const taskRequest = BuilderTaskRequestSchema.parse({
      workflowId: workflow.id,
      task: executableTask,
      workspacePath,
      repositoryProfile,
      previousAttempts: previousAttemptRows.map((row) => ({
        attemptNumber: row.attemptNumber,
        status: row.status,
        summary: row.failureMessage ?? undefined,
      })),
      remediationInstructions: pendingRemediation ? [pendingRemediation] : undefined,
    });

    const handle = await adapter.executeTask(session, taskRequest);

    const deadline = Date.now() + executableTask.execution.timeoutSeconds * 1000;
    let finalStatusState: Awaited<ReturnType<typeof adapter.getStatus>> | null = null;
    let wasCancelled = false;

    while (Date.now() < deadline) {
      const status = await adapter.getStatus(handle);
      if (isTerminalExecutionState(status.state)) {
        finalStatusState = status;
        break;
      }

      const currentWorkflow = await deps.prisma.workflow.findUnique({
        where: { id: workflow.id },
        select: { status: true },
      });
      if (currentWorkflow?.status === "cancelled") {
        wasCancelled = true;
        break;
      }

      await deps.leaseService.heartbeat(leaseId, executableTask.execution.leaseDurationSeconds);
      await sleep(pollIntervalMs);
    }

    if (wasCancelled) {
      await adapter.cancel(handle);
      const afterSha = await getCurrentCommitSha(workspacePath);
      await deps.prisma.taskAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          builderResultJson: { independentBeforeSha: beforeSha, independentAfterSha: afterSha, status: "cancelled" },
        },
      });
      await deps.taskService.transitionTask(taskId, "cancelled", { type: "task.cancelled" });
      await deps.leaseService.release(leaseId);
      taskDurationSeconds.observe((Date.now() - attemptStartedAt) / 1000);
      return;
    }

    let result: BuilderResult;
    if (finalStatusState) {
      result = await adapter.collectResult(handle);
    } else {
      await adapter.cancel(handle);
      result = {
        status: "timed_out",
        summary: `Task exceeded its ${executableTask.execution.timeoutSeconds}s execution timeout.`,
        changedFiles: [],
        createdFiles: [],
        deletedFiles: [],
        commandsRun: [],
        reportedTests: [],
        warnings: [],
        failure: { code: "builder_timeout", message: "Execution did not reach a terminal state before the timeout." },
      };
    }

    const afterSha = await getCurrentCommitSha(workspacePath);

    await deps.prisma.taskAttempt.update({
      where: { id: attempt.id },
      data: {
        status: RESULT_STATUS_TO_TASK_STATUS[result.status],
        completedAt: new Date(),
        failureClass: result.failure ? "builder" : null,
        failureCode: result.failure?.code,
        failureMessage: result.failure?.message,
        builderResultJson: { ...result, independentBeforeSha: beforeSha, independentAfterSha: afterSha } as object,
      },
    });
    taskDurationSeconds.observe((Date.now() - attemptStartedAt) / 1000);

    if (result.status === "completed") {
      await deps.taskService.transitionTask(taskId, "builder_completed", {
        type: "task.builder_completed",
        payload: { attemptNumber, changedFiles: result.changedFiles, commitSha: afterSha },
      });
      await deps.leaseService.release(leaseId);
      await deps.jobEnqueuer.enqueue("task.verify", { taskId }, `${taskId}.task.verify.${attemptNumber}`);
      return;
    }

    if (result.status === "cancelled") {
      await deps.taskService.transitionTask(taskId, "cancelled", { type: "task.cancelled" });
      await deps.leaseService.release(leaseId);
      await recordTerminalOutcome(deps, workflow.id, null);
      return;
    }

    const workflowFailure = await handleBuilderFailure(
      deps,
      workflow.id,
      workflow.policyProfileId,
      taskId,
      executableTask,
      attemptNumber,
      result,
    );
    await deps.leaseService.release(leaseId);
    await recordTerminalOutcome(deps, workflow.id, workflowFailure);
  };
}

async function handleBuilderFailure(
  deps: TaskDispatchDependencies,
  workflowId: string,
  policyProfileId: string,
  taskId: string,
  executableTask: ExecutableTask,
  attemptNumber: number,
  result: BuilderResult,
): Promise<Awaited<ReturnType<WorkflowService["evaluateFailureAfterTaskFailure"]>>> {
  const policy = deps.policyService.resolve(policyProfileId);
  const globalRetriesUsed = await deps.prisma.taskAttempt.count({
    where: { task: { workflowId }, attemptType: { in: ["retry", "remediation"] } },
  });

  const decision = decideRetry({
    attemptsSoFar: attemptNumber,
    maxBuilderAttempts: executableTask.execution.maxBuilderAttempts,
    globalRetriesUsed,
    globalRetryBudget: policy.globalRetryBudget,
  });

  const failureClass: FailureClass = "builder";

  if (decision.action === "retry") {
    await deps.taskService.transitionTask(
      taskId,
      "retry_scheduled",
      {
        type: "task.retry_scheduled",
        payload: { backoffSeconds: decision.backoffSeconds, reason: result.failure?.message, failureClass },
      },
      { retryEligibleAt: new Date(Date.now() + decision.backoffSeconds * 1000) },
    );
    return null;
  }

  tasksFailedTotal.inc();
  await deps.taskService.transitionTask(taskId, "failed", {
    type: "task.failed",
    payload: { reason: decision.reason, failureClass },
  });
  return deps.workflowService.evaluateFailureAfterTaskFailure(taskId, policy);
}

