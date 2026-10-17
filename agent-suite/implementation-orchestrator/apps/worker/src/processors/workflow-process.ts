import type { Job } from "bullmq";
import {
  EventService,
  ManifestValidationService,
  WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import { WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { inspectRepository } from "@implementation-orchestrator/repository-inspector";
import { workflowsFailedTotal } from "@implementation-orchestrator/observability";
import type { JobEnqueuer } from "../job-enqueuer.js";

export interface WorkflowProcessJobData {
  workflowId: string;
}

export interface WorkflowProcessDependencies {
  workflowService: WorkflowService;
  eventService: EventService;
  manifestValidationService: ManifestValidationService;
  workspaceManager: WorkspaceManager;
  jobEnqueuer: JobEnqueuer;
  inspect?: typeof inspectRepository;
}

export function createWorkflowProcessProcessor(deps: WorkflowProcessDependencies) {
  const inspect = deps.inspect ?? inspectRepository;

  return async function processWorkflow(job: Job<WorkflowProcessJobData>): Promise<void> {
    const { workflowId } = job.data;
    const current = await deps.workflowService.getForProcessing(workflowId);

    if (current.status !== "created") {
      return;
    }

    await deps.workflowService.transitionStatus(workflowId, "validating_manifest");

    const validation = deps.manifestValidationService.validate(current.manifest);
    if (!validation.valid) {
      workflowsFailedTotal.inc();
      await deps.workflowService.markFailed(workflowId, {
        failureCode: "manifest_invalid",
        failureClass: "manifest",
        failureMessage: validation.errors.join("; "),
      });
      return;
    }

    await deps.eventService.record({
      id: `${workflowId}.workflow.manifest_validated`,
      type: "workflow.manifest_validated",
      workflowId,
      source: "worker",
      payload: { warnings: validation.warnings },
    });

    await deps.workflowService.transitionStatus(workflowId, "inspecting_repository", {
      type: "workflow.repository_inspection_started",
    });

    let prepared;
    try {
      prepared = await deps.workspaceManager.prepareWorkspace(workflowId, current.repositoryConfig);
    } catch (error) {
      workflowsFailedTotal.inc();
      await deps.workflowService.markFailed(workflowId, {
        failureCode: "repository_unavailable",
        failureClass: "environment",
        failureMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const profile = await inspect(prepared.workspacePath, current.repositoryConfig);

    await deps.workflowService.recordRepositoryProfile(workflowId, {
      repositoryProfile: profile,
      baseCommitSha: prepared.baseCommitSha,
      workflowBranch: prepared.workflowBranch,
      workspacePath: prepared.workspacePath,
    });

    await deps.eventService.record({
      id: `${workflowId}.workflow.repository_inspection_completed`,
      type: "workflow.repository_inspection_completed",
      workflowId,
      source: "worker",
      payload: { commitSha: profile.commitSha, risks: profile.risks },
    });

    await deps.workflowService.transitionStatus(workflowId, "compiling_tasks");

    await deps.jobEnqueuer.enqueue(
      "workflow.compile",
      { workflowId },
      `${workflowId}.workflow.compile`,
    );
  };
}
