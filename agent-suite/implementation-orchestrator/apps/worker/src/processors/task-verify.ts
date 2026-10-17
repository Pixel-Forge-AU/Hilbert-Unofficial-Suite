import type { Job } from "bullmq";
import type { PrismaClient } from "@implementation-orchestrator/database";
import { ExecutableTaskSchema, type RemediationInstruction } from "@implementation-orchestrator/contracts";
import {
  decideRetry,
  type ArtifactService,
  type DependencyService,
  type EventService,
  type PolicyService,
  type TaskService,
  type WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { summarizeFailedChecks, VerificationRunner } from "@implementation-orchestrator/verification-runner";
import {
  tasksAcceptedTotal,
  tasksFailedTotal,
  verificationFailuresTotal,
  verificationRunsTotal,
  workflowsCompletedTotal,
} from "@implementation-orchestrator/observability";
import type { JobEnqueuer } from "../job-enqueuer.js";
import { recordTerminalOutcome } from "../terminal-outcome.js";

export interface TaskVerifyJobData {
  taskId: string;
}

export interface TaskVerifyDependencies {
  prisma: PrismaClient;
  taskService: TaskService;
  workflowService: WorkflowService;
  eventService: EventService;
  dependencyService: DependencyService;
  policyService: PolicyService;
  artifactService: ArtifactService;
  jobEnqueuer: JobEnqueuer;
  verificationRunner?: VerificationRunner;
}

export function createTaskVerifyProcessor(deps: TaskVerifyDependencies) {
  const verificationRunner = deps.verificationRunner ?? new VerificationRunner();

  return async function processVerify(job: Job<TaskVerifyJobData>): Promise<void> {
    const { taskId } = job.data;

    const taskRow = await deps.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (taskRow.status !== "builder_completed") {
      return;
    }

    const workflow = await deps.prisma.workflow.findUniqueOrThrow({ where: { id: taskRow.workflowId } });
    const executableTask = ExecutableTaskSchema.parse(taskRow.contractJson);

    const latestAttempt = await deps.prisma.taskAttempt.findFirstOrThrow({
      where: { taskId },
      orderBy: { attemptNumber: "desc" },
    });
    const builderResult = latestAttempt.builderResultJson as { independentBeforeSha?: string } | null;
    const baseCommitSha = builderResult?.independentBeforeSha ?? workflow.baseCommitSha ?? "HEAD";

    await deps.taskService.transitionTask(taskId, "verifying", { type: "task.verification_started" });

    const result = await verificationRunner.run({
      taskId,
      attemptId: latestAttempt.id,
      workspacePath: workflow.workspacePath!,
      baseCommitSha,
      scope: executableTask.scope,
      verificationPlan: executableTask.verification,
    });

    verificationRunsTotal.inc();
    if (!result.passed) {
      verificationFailuresTotal.inc();
    }

    await deps.prisma.verificationRun.create({
      data: {
        taskId,
        attemptId: latestAttempt.id,
        status: result.passed ? "passed" : "failed",
        passed: result.passed,
        resultJson: result as object,
        startedAt: new Date(result.startedAt),
        completedAt: new Date(result.completedAt),
      },
    });

    if (result.passed) {
      tasksAcceptedTotal.inc();
      await deps.taskService.transitionTask(taskId, "accepted", {
        type: "task.accepted",
        payload: { attemptNumber: latestAttempt.attemptNumber },
      });
      await deps.dependencyService.recheckAfterAcceptance(workflow.id, taskId);

      const completionSummary = await deps.workflowService.evaluateCompletionAfterTaskAcceptance(workflow.id);
      if (completionSummary) {
        workflowsCompletedTotal.inc();
        await deps.artifactService.storeJson({
          workflowId: workflow.id,
          artifactType: "workflow_summary",
          data: completionSummary,
        });
      } else {
        await deps.jobEnqueuer.enqueue(
          "workflow.schedule",
          { workflowId: workflow.id },
          `${workflow.id}.workflow.schedule.${Date.now()}`,
        );
      }
      return;
    }

    const failedChecks = summarizeFailedChecks(result.checks);
    await deps.taskService.transitionTask(taskId, "verification_failed", {
      type: "task.verification_failed",
      payload: { failedChecks },
    });

    const policy = deps.policyService.resolve(workflow.policyProfileId);
    const remediationAttemptsSoFar = await deps.prisma.taskAttempt.count({
      where: { taskId, attemptType: "remediation" },
    });
    const globalRetriesUsed = await deps.prisma.taskAttempt.count({
      where: { task: { workflowId: workflow.id }, attemptType: { in: ["retry", "remediation"] } },
    });
    const decision = decideRetry({
      attemptsSoFar: remediationAttemptsSoFar,
      maxBuilderAttempts: executableTask.execution.maxRemediationCycles,
      globalRetriesUsed,
      globalRetryBudget: policy.globalRetryBudget,
    });

    if (decision.action === "retry") {
      const remediationInstruction: RemediationInstruction = {
        taskId: executableTask.id,
        attempt: latestAttempt.attemptNumber + 1,
        failureClass: "verification",
        failedChecks,
        instruction:
          "Correct the listed verification failures without expanding task scope. Preserve all passing behaviour and rerun the required checks.",
      };

      await deps.taskService.transitionTask(taskId, "remediation_required");
      await deps.taskService.transitionTask(
        taskId,
        "ready",
        { type: "task.ready" },
        { remediationInstructionJson: remediationInstruction as unknown as object },
      );
      await deps.jobEnqueuer.enqueue(
        "workflow.schedule",
        { workflowId: workflow.id },
        `${workflow.id}.workflow.schedule.${Date.now()}`,
      );
    } else {
      tasksFailedTotal.inc();
      await deps.taskService.transitionTask(taskId, "failed", {
        type: "task.failed",
        payload: { reason: decision.reason, failureClass: "verification" },
      });
      const workflowFailure = await deps.workflowService.evaluateFailureAfterTaskFailure(taskId, policy);
      await recordTerminalOutcome(deps, workflow.id, workflowFailure);
    }
  };
}
