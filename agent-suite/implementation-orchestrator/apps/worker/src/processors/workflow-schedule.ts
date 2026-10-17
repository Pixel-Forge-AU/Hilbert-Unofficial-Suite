import type { Job } from "bullmq";
import type { PrismaClient } from "@implementation-orchestrator/database";
import type { TaskPriority } from "@implementation-orchestrator/contracts";
import {
  LeaseAlreadyActiveError,
  TaskNotReadyError,
  selectRunnableTasks,
  type LeaseService,
  type PolicyService,
} from "@implementation-orchestrator/orchestrator-core";
import type { JobEnqueuer } from "../job-enqueuer.js";

export interface WorkflowScheduleJobData {
  workflowId: string;
}

export interface WorkflowScheduleDependencies {
  prisma: PrismaClient;
  policyService: PolicyService;
  leaseService: LeaseService;
  jobEnqueuer: JobEnqueuer;
}

export function createWorkflowScheduleProcessor(deps: WorkflowScheduleDependencies) {
  return async function processSchedule(job: Job<WorkflowScheduleJobData>): Promise<void> {
    const { workflowId } = job.data;
    const workflow = await deps.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });

    if (workflow.status !== "running") {
      return;
    }

    const policy = deps.policyService.resolve(workflow.policyProfileId);

    const readyRows = await deps.prisma.task.findMany({ where: { workflowId, status: "ready" } });
    if (readyRows.length === 0) {
      return;
    }

    const dependentCounts = await deps.prisma.taskDependency.groupBy({
      by: ["toTaskId"],
      where: { workflowId, dependencyType: "hard" },
      _count: { toTaskId: true },
    });
    const dependentCountByTaskId = new Map(dependentCounts.map((d) => [d.toTaskId, d._count.toTaskId]));

    const currentlyActiveCount = await deps.prisma.task.count({
      where: { workflowId, status: { in: ["leased", "running"] } },
    });

    const selected = selectRunnableTasks({
      readyTasks: readyRows.map((row) => ({
        id: row.id,
        priority: row.priority as TaskPriority,
        phaseOrder: row.phaseOrder,
        dependentCount: dependentCountByTaskId.get(row.id) ?? 0,
        readyAt: row.readyAt ?? row.createdAt,
      })),
      currentlyActiveCount,
      maxConcurrentTasks: policy.maxConcurrentTasks,
    });

    for (const task of selected) {
      let lease;
      try {
        lease = await deps.leaseService.acquireLease(
          task.id,
          workflow.builderProfileId,
          policy.taskDefaults.leaseDurationSeconds,
        );
      } catch (error) {
        if (error instanceof LeaseAlreadyActiveError || error instanceof TaskNotReadyError) {
          continue;
        }
        throw error;
      }

      await deps.jobEnqueuer.enqueue(
        "task.dispatch",
        { taskId: task.id, leaseId: lease.id },
        `${task.id}.task.dispatch.${lease.id}`,
      );
    }
  };
}
