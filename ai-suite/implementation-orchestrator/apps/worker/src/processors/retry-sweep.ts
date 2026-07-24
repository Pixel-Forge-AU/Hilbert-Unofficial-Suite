import type { PrismaClient } from "@implementation-orchestrator/database";
import type { TaskService } from "@implementation-orchestrator/orchestrator-core";
import type { JobEnqueuer } from "../job-enqueuer.js";

export interface RetrySweepDependencies {
  prisma: PrismaClient;
  taskService: TaskService;
  jobEnqueuer: JobEnqueuer;
}

export function createRetrySweepProcessor(deps: RetrySweepDependencies) {
  return async function sweep(_job?: unknown): Promise<void> {
    void _job;

    const eligibleTasks = await deps.prisma.task.findMany({
      where: { status: "retry_scheduled", retryEligibleAt: { lte: new Date() } },
    });

    const touchedWorkflowIds = new Set<string>();

    for (const task of eligibleTasks) {
      await deps.taskService.transitionTask(
        task.id,
        "ready",
        { type: "task.ready" },
        { retryEligibleAt: null },
      );
      touchedWorkflowIds.add(task.workflowId);
    }

    for (const workflowId of touchedWorkflowIds) {
      await deps.jobEnqueuer.enqueue(
        "workflow.schedule",
        { workflowId },
        `${workflowId}.workflow.schedule.${Date.now()}`,
      );
    }
  };
}
