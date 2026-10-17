import type { PrismaClient } from "@implementation-orchestrator/database";
import {
  decideRetry,
  type ArtifactService,
  type EventService,
  type LeaseService,
  type PolicyService,
  type TaskService,
  type WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { activeLeases, expiredLeasesTotal, tasksFailedTotal } from "@implementation-orchestrator/observability";
import { recordTerminalOutcome } from "../terminal-outcome.js";

export interface LeaseSweepDependencies {
  prisma: PrismaClient;
  leaseService: LeaseService;
  taskService: TaskService;
  workflowService: WorkflowService;
  eventService: EventService;
  policyService: PolicyService;
  artifactService: ArtifactService;
}

export function createLeaseSweepProcessor(deps: LeaseSweepDependencies) {
  return async function sweep(_job?: unknown): Promise<void> {
    void _job;
    const activeCount = await deps.prisma.taskLease.count({ where: { status: "active" } });
    activeLeases.set(activeCount);

    const expiredLeases = await deps.leaseService.findExpiredActiveLeases();

    for (const expired of expiredLeases) {
      const wasMarked = await deps.leaseService.markExpired(expired.leaseId);
      if (!wasMarked) {
        continue;
      }
      expiredLeasesTotal.inc();

      await deps.eventService.record({
        id: `${expired.workflowId}.${expired.taskId}.lease.expired.${expired.leaseId}`,
        type: "lease.expired",
        workflowId: expired.workflowId,
        taskId: expired.taskId,
        source: "lease-sweep",
        payload: { leaseId: expired.leaseId },
      });

      if (expired.taskStatus === "leased") {
        await deps.taskService.transitionTask(expired.taskId, "ready", { type: "task.ready" });
        continue;
      }

      if (expired.taskStatus === "running") {
        const workflow = await deps.prisma.workflow.findUniqueOrThrow({ where: { id: expired.workflowId } });
        const policy = deps.policyService.resolve(workflow.policyProfileId);

        const attemptsSoFar = await deps.prisma.taskAttempt.count({ where: { taskId: expired.taskId } });
        const globalRetriesUsed = await deps.prisma.taskAttempt.count({
          where: { task: { workflowId: expired.workflowId }, attemptType: { in: ["retry", "remediation"] } },
        });

        const decision = decideRetry({
          attemptsSoFar,
          maxBuilderAttempts: policy.taskDefaults.maxBuilderAttempts,
          globalRetriesUsed,
          globalRetryBudget: policy.globalRetryBudget,
        });

        if (decision.action === "retry") {
          await deps.taskService.transitionTask(
            expired.taskId,
            "retry_scheduled",
            {
              type: "task.retry_scheduled",
              payload: { backoffSeconds: decision.backoffSeconds, reason: "lease_expired" },
            },
            { retryEligibleAt: new Date(Date.now() + decision.backoffSeconds * 1000) },
          );
        } else {
          tasksFailedTotal.inc();
          await deps.taskService.transitionTask(expired.taskId, "failed", {
            type: "task.failed",
            payload: { reason: decision.reason },
          });
          const workflowFailure = await deps.workflowService.evaluateFailureAfterTaskFailure(expired.taskId, policy);
          await recordTerminalOutcome(deps, expired.workflowId, workflowFailure);
        }
      }
    }
  };
}
