import type { Job } from "bullmq";
import type { DependencyService, WorkflowService } from "@implementation-orchestrator/orchestrator-core";
import type { JobEnqueuer } from "../job-enqueuer.js";

export interface WorkflowPrepareJobData {
  workflowId: string;
}

export interface WorkflowPrepareDependencies {
  workflowService: WorkflowService;
  dependencyService: DependencyService;
  jobEnqueuer: JobEnqueuer;
}

export function createWorkflowPrepareProcessor(deps: WorkflowPrepareDependencies) {
  return async function processPrepare(job: Job<WorkflowPrepareJobData>): Promise<void> {
    const { workflowId } = job.data;
    const current = await deps.workflowService.getForProcessing(workflowId);

    if (current.status !== "preparing_workspace") {
      return;
    }

    await deps.dependencyService.computeInitialReadiness(workflowId);

    await deps.workflowService.transitionStatus(workflowId, "running", { type: "workflow.running" });

    await deps.jobEnqueuer.enqueue("workflow.schedule", { workflowId }, `${workflowId}.workflow.schedule.${Date.now()}`);
  };
}
