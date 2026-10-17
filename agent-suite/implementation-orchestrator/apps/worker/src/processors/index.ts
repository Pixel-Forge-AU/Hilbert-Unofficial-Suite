import type { Job } from "bullmq";
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
import { WorkspaceManager } from "@implementation-orchestrator/workspace-manager";
import { DeterministicTaskCompiler } from "@implementation-orchestrator/task-compiler";
import { BuilderGateway, MockBuilderAdapter, OpenHandsAdapter, type BuilderAdapter } from "@implementation-orchestrator/builder-gateway";
import type { PrismaClient } from "@implementation-orchestrator/database";
import type { WorkerConfig } from "../config.js";
import type { JobEnqueuer } from "../job-enqueuer.js";
import { createEventRecordProcessor } from "./event-record.js";
import { createWorkflowProcessProcessor } from "./workflow-process.js";
import { createWorkflowCompileProcessor } from "./workflow-compile.js";
import { createWorkflowPrepareProcessor } from "./workflow-prepare.js";
import { createWorkflowScheduleProcessor } from "./workflow-schedule.js";
import { createLeaseSweepProcessor } from "./lease-sweep.js";
import { createRetrySweepProcessor } from "./retry-sweep.js";
import { createTaskDispatchProcessor } from "./task-dispatch.js";
import { createTaskVerifyProcessor } from "./task-verify.js";

export type JobProcessor = (job: Job) => Promise<unknown>;

function buildBuilderGateway(config: WorkerConfig): BuilderGateway {
  const adapters: Record<string, BuilderAdapter> = { mock: new MockBuilderAdapter() };

  const { baseUrl, llmModel, llmApiKey } = config.openHands;
  if (baseUrl && llmModel && llmApiKey) {
    adapters["openhands-local"] = new OpenHandsAdapter({
      baseUrl,
      sessionApiKey: config.openHands.sessionApiKey,
      llmModel,
      llmApiKey,
      llmBaseUrl: config.openHands.llmBaseUrl,
      llmUsageId: config.openHands.llmUsageId,
      hostWorkspaceRoot: config.workspaceRoot,
      containerWorkspaceRoot: config.openHands.containerWorkspaceRoot,
    });
  }

  return new BuilderGateway(adapters);
}

export function buildProcessorRegistry(
  prisma: PrismaClient,
  config: WorkerConfig,
  jobEnqueuer: JobEnqueuer,
): Record<string, JobProcessor> {
  const eventService = new EventService(prisma);
  const workflowService = new WorkflowService(prisma);
  const taskService = new TaskService(prisma);
  const manifestValidationService = new ManifestValidationService();
  const workspaceManager = new WorkspaceManager(config.workspaceRoot);
  const policyService = new PolicyService();
  const compiler = new DeterministicTaskCompiler();
  const dependencyService = new DependencyService(prisma);
  const leaseService = new LeaseService(prisma);
  const artifactService = new ArtifactService(prisma, config.artifactStoragePath);
  const builderGateway = buildBuilderGateway(config);

  return {
    "event.record": createEventRecordProcessor(eventService),
    "workflow.process": createWorkflowProcessProcessor({
      workflowService,
      eventService,
      manifestValidationService,
      workspaceManager,
      jobEnqueuer,
    }),
    "workflow.compile": createWorkflowCompileProcessor({
      workflowService,
      eventService,
      policyService,
      compiler,
      jobEnqueuer,
    }),
    "workflow.prepare": createWorkflowPrepareProcessor({
      workflowService,
      dependencyService,
      jobEnqueuer,
    }),
    "workflow.schedule": createWorkflowScheduleProcessor({
      prisma,
      policyService,
      leaseService,
      jobEnqueuer,
    }),
    "lease.sweep": createLeaseSweepProcessor({
      prisma,
      leaseService,
      taskService,
      workflowService,
      eventService,
      policyService,
      artifactService,
    }),
    "retry.sweep": createRetrySweepProcessor({
      prisma,
      taskService,
      jobEnqueuer,
    }),
    "task.dispatch": createTaskDispatchProcessor({
      prisma,
      taskService,
      workflowService,
      leaseService,
      eventService,
      policyService,
      artifactService,
      builderGateway,
      jobEnqueuer,
      pollIntervalMs: config.taskPollIntervalMs,
    }),
    "task.verify": createTaskVerifyProcessor({
      prisma,
      taskService,
      workflowService,
      eventService,
      dependencyService,
      policyService,
      artifactService,
      jobEnqueuer,
    }),
  };
}

export function createRouter(registry: Record<string, JobProcessor>) {
  return async function route(job: Job): Promise<unknown> {
    const processor = registry[job.name];
    if (!processor) {
      throw new Error(`No processor registered for job name: ${job.name}`);
    }
    return processor(job);
  };
}
