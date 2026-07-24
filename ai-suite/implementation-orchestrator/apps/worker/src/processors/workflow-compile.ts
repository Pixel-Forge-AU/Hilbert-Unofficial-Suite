import type { Job } from "bullmq";
import { BuildManifestSchema } from "@implementation-orchestrator/contracts";
import {
  deriveCompilationManifest,
  type EventService,
  type PolicyService,
  type WorkflowService,
} from "@implementation-orchestrator/orchestrator-core";
import {
  COMPILER_VERSION,
  DEFAULT_TASK_COMPILER_CONFIG,
  validateTaskGraph,
  type TaskCompiler,
} from "@implementation-orchestrator/task-compiler";
import { tasksTotal, workflowsFailedTotal } from "@implementation-orchestrator/observability";
import type { JobEnqueuer } from "../job-enqueuer.js";

export interface WorkflowCompileJobData {
  workflowId: string;
}

export interface WorkflowCompileDependencies {
  workflowService: WorkflowService;
  eventService: EventService;
  policyService: PolicyService;
  compiler: TaskCompiler;
  jobEnqueuer: JobEnqueuer;
}

export function createWorkflowCompileProcessor(deps: WorkflowCompileDependencies) {
  return async function processCompile(job: Job<WorkflowCompileJobData>): Promise<void> {
    const { workflowId } = job.data;
    const current = await deps.workflowService.getForCompilation(workflowId);

    if (current.status !== "compiling_tasks") {
      return;
    }

    const manifest = deriveCompilationManifest(BuildManifestSchema.parse(current.manifest));
    const policy = deps.policyService.resolve(current.policyProfileId);

    const graph = await deps.compiler.compile({
      manifest,
      repository: current.repositoryProfile,
      policy,
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: current.builderProfileId,
      workflowBranch: current.workflowBranch,
    });

    const validation = validateTaskGraph({
      manifest,
      tasks: graph.tasks,
      dependencies: graph.dependencies,
      phases: graph.phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });

    if (!validation.valid) {
      workflowsFailedTotal.inc();
      await deps.workflowService.markFailed(workflowId, {
        failureCode: "task_graph_invalid",
        failureClass: "manifest",
        failureMessage: validation.errors.map((e) => e.message).join("; "),
      });
      return;
    }

    tasksTotal.inc(graph.tasks.length);
    await deps.workflowService.persistTaskGraph(workflowId, graph);

    await deps.eventService.record({
      id: `${workflowId}.workflow.task_compilation_completed`,
      type: "workflow.task_compilation_completed",
      workflowId,
      source: "worker",
      payload: { taskCount: graph.tasks.length, coverage: graph.coverage, warnings: graph.warnings },
    });

    await deps.workflowService.transitionStatus(workflowId, "validating_task_graph");

    await deps.workflowService.transitionStatus(workflowId, "preparing_workspace", {
      type: "workflow.task_graph_validated",
      payload: { coverage: validation.coverage },
    });

    await deps.jobEnqueuer.enqueue("workflow.prepare", { workflowId }, `${workflowId}.workflow.prepare`);
  };
}
