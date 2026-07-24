import type { PrismaClient } from "@implementation-orchestrator/database";
import {
  hashManifest,
  isTerminalWorkflowStatus,
  isValidWorkflowTransition,
  TASK_TERMINAL_STATUSES,
  type CompiledTaskGraph,
  type CreateWorkflowRequest,
  type ExecutionPolicy,
  type RepositoryConfig,
  type RepositoryProfile,
  type WorkflowCompletionSummary,
  type WorkflowEventType,
  type WorkflowFailure,
  type WorkflowStatus,
  type WorkflowSummary,
  type TaskStatus,
} from "@implementation-orchestrator/contracts";
import { getCurrentCommitSha } from "@implementation-orchestrator/workspace-manager";
import { EventService } from "./event-service.js";

export class MissingRepositoryProfileError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} has no repository profile recorded yet.`);
    this.name = "MissingRepositoryProfileError";
  }
}

export interface WorkflowCompilationInput {
  workflowId: string;
  status: WorkflowStatus;
  manifest: unknown;
  repositoryProfile: RepositoryProfile;
  workflowBranch: string;
  builderProfileId: string;
  policyProfileId: string;
}

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow not found: ${workflowId}`);
    this.name = "WorkflowNotFoundError";
  }
}

export class InvalidWorkflowTransitionError extends Error {
  constructor(from: WorkflowStatus, to: WorkflowStatus) {
    super(`Invalid workflow transition: ${from} -> ${to}`);
    this.name = "InvalidWorkflowTransitionError";
  }
}

export interface WorkflowProcessingInput {
  workflowId: string;
  status: WorkflowStatus;
  manifest: unknown;
  repositoryConfig: RepositoryConfig;
}

const TIMESTAMP_FIELD_BY_STATUS: Partial<Record<WorkflowStatus, "startedAt" | "completedAt" | "failedAt" | "cancelledAt">> = {
  running: "startedAt",
  completed: "completedAt",
  failed: "failedAt",
  cancelled: "cancelledAt",
};

export class WorkflowService {
  private readonly events: EventService;

  constructor(private readonly prisma: PrismaClient) {
    this.events = new EventService(prisma);
  }

  async createWorkflow(request: CreateWorkflowRequest): Promise<WorkflowSummary> {
    const manifestHash = hashManifest(request.manifest);
    const manifestVersion =
      typeof (request.manifest as Record<string, unknown>).manifestVersion === "string"
        ? ((request.manifest as Record<string, unknown>).manifestVersion as string)
        : "unknown";

    const workflow = await this.prisma.workflow.create({
      data: {
        name: request.name,
        status: "created",
        manifestVersion,
        manifestHash,
        manifestJson: request.manifest as object,
        repositoryConfigJson: request.repository as object,
        policyProfileId: request.policyProfile,
        builderProfileId: request.builderProfile,
      },
    });

    await this.events.record({
      id: `${workflow.id}.workflow.created`,
      type: "workflow.created",
      workflowId: workflow.id,
      source: "workflow-service",
      payload: { manifestHash, name: request.name },
    });

    return this.toSummary(workflow.id);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowSummary> {
    return this.toSummary(workflowId);
  }

  async listWorkflows(): Promise<WorkflowSummary[]> {
    const rows = await this.prisma.workflow.findMany({ orderBy: { createdAt: "desc" } });
    return Promise.all(rows.map((row) => this.toSummary(row.id)));
  }

  async getForProcessing(workflowId: string): Promise<WorkflowProcessingInput> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    return {
      workflowId: workflow.id,
      status: workflow.status,
      manifest: workflow.manifestJson,
      repositoryConfig: workflow.repositoryConfigJson as RepositoryConfig,
    };
  }

  async getForCompilation(workflowId: string): Promise<WorkflowCompilationInput> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    if (!workflow.repositoryProfileJson) {
      throw new MissingRepositoryProfileError(workflowId);
    }
    if (!workflow.workflowBranch) {
      throw new MissingRepositoryProfileError(workflowId);
    }
    return {
      workflowId: workflow.id,
      status: workflow.status,
      manifest: workflow.manifestJson,
      repositoryProfile: workflow.repositoryProfileJson as RepositoryProfile,
      workflowBranch: workflow.workflowBranch,
      builderProfileId: workflow.builderProfileId,
      policyProfileId: workflow.policyProfileId,
    };
  }

  async persistTaskGraph(workflowId: string, graph: CompiledTaskGraph): Promise<void> {
    const existingCount = await this.prisma.task.count({ where: { workflowId } });
    if (existingCount > 0) {
      return;
    }

    const phaseOrderById = new Map(graph.phases.map((phase) => [phase.id, phase.order]));

    await this.prisma.$transaction(async (tx) => {
      const internalIdByExternalId = new Map<string, string>();

      for (const task of graph.tasks) {
        const created = await tx.task.create({
          data: {
            workflowId,
            externalTaskId: task.id,
            status: "pending",
            phaseId: task.phaseId,
            phaseOrder: phaseOrderById.get(task.phaseId) ?? 0,
            title: task.title,
            objective: task.objective,
            category: task.category,
            priority: task.priority,
            builderProfile: task.builderProfile,
            contractJson: task as object,
          },
        });
        internalIdByExternalId.set(task.id, created.id);
      }

      for (const dependency of graph.dependencies) {
        const fromId = internalIdByExternalId.get(dependency.fromTaskId);
        const toId = internalIdByExternalId.get(dependency.toTaskId);
        if (!fromId || !toId) {
          continue;
        }
        await tx.taskDependency.create({
          data: {
            workflowId,
            fromTaskId: fromId,
            toTaskId: toId,
            dependencyType: dependency.type,
            reason: dependency.reason,
          },
        });
      }
    });
  }

  async transitionStatus(
    workflowId: string,
    to: WorkflowStatus,
    event?: { type: WorkflowEventType; payload?: unknown },
  ): Promise<void> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    const from = workflow.status;
    if (from === to) {
      return;
    }
    if (!isValidWorkflowTransition(from, to)) {
      throw new InvalidWorkflowTransitionError(from, to);
    }

    const timestampField = TIMESTAMP_FIELD_BY_STATUS[to];
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });

    if (event) {
      await this.events.record({
        id: `${workflowId}.${event.type}`,
        type: event.type,
        workflowId,
        source: "workflow-service",
        payload: event.payload ?? {},
      });
    }
  }

  async markFailed(
    workflowId: string,
    failure: {
      failureCode: string;
      failureClass: string;
      failureMessage: string;
      stage?: string;
      taskId?: string;
      evidence?: Record<string, unknown>;
      suggestedOperatorAction?: string;
    },
  ): Promise<WorkflowFailure> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    if (!isValidWorkflowTransition(workflow.status, "failed")) {
      throw new InvalidWorkflowTransitionError(workflow.status, "failed");
    }

    const failureDetails: WorkflowFailure = {
      workflowId,
      status: "failed",
      failureCode: failure.failureCode,
      failureClass: failure.failureClass,
      stage: failure.stage ?? workflow.status,
      taskId: failure.taskId ?? null,
      evidence: failure.evidence,
      lastSuccessfulState: workflow.status,
      suggestedOperatorAction: failure.suggestedOperatorAction ?? null,
      failedAt: new Date().toISOString(),
    };

    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureCode: failure.failureCode,
        failureMessage: failure.failureMessage,
        failureDetailsJson: failureDetails as object,
      },
    });

    await this.events.record({
      id: `${workflowId}.workflow.failed`,
      type: "workflow.failed",
      workflowId,
      source: "workflow-service",
      payload: failure,
    });

    return failureDetails;
  }

  async evaluateFailureAfterTaskFailure(taskId: string, policy: ExecutionPolicy): Promise<WorkflowFailure | null> {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: task.workflowId } });
    if (isTerminalWorkflowStatus(workflow.status)) {
      return null;
    }

    if (task.priority === "essential" || task.priority === "blocking") {
      return this.markFailed(workflow.id, {
        failureCode: "essential_task_failed",
        failureClass: "internal",
        failureMessage: `Task "${task.title}" (priority: ${task.priority}) reached terminal failure.`,
        taskId,
      });
    }

    const globalRetriesUsed = await this.prisma.taskAttempt.count({
      where: { task: { workflowId: workflow.id }, attemptType: { in: ["retry", "remediation"] } },
    });
    if (globalRetriesUsed >= policy.globalRetryBudget) {
      return this.markFailed(workflow.id, {
        failureCode: "global_retry_budget_exceeded",
        failureClass: "internal",
        failureMessage: `Workflow exceeded its global retry budget (${policy.globalRetryBudget}).`,
        taskId,
      });
    }

    return null;
  }

  // Safe by construction: if an essential/blocking task had failed, evaluateFailureAfterTaskFailure already terminated the workflow.
  async evaluateCompletionAfterTaskAcceptance(workflowId: string): Promise<WorkflowCompletionSummary | null> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    if (isTerminalWorkflowStatus(workflow.status)) {
      return null;
    }

    const tasks = await this.prisma.task.findMany({ where: { workflowId } });
    if (tasks.length === 0) {
      return null;
    }
    const allTerminal = tasks.every((task) => TASK_TERMINAL_STATUSES.includes(task.status));
    if (!allTerminal) {
      return null;
    }

    const activeLeases = await this.prisma.taskLease.count({
      where: { task: { workflowId }, status: "active" },
    });
    if (activeLeases > 0) {
      return null;
    }

    const finalCommitSha = workflow.workspacePath
      ? await getCurrentCommitSha(workflow.workspacePath)
      : (workflow.baseCommitSha ?? "");

    const acceptedTasks = tasks.filter((task) => task.status === "accepted").length;
    const nonEssentialTasks = tasks.filter((task) => task.priority !== "essential" && task.priority !== "blocking");
    const failedOptionalTasks = nonEssentialTasks.filter((task) => task.status === "failed").length;
    const skippedOptionalTasks = nonEssentialTasks.filter((task) => task.status === "cancelled").length;

    const summary: WorkflowCompletionSummary = {
      workflowId,
      status: "completed",
      manifestHash: workflow.manifestHash,
      baseCommitSha: workflow.baseCommitSha ?? "",
      finalCommitSha,
      acceptedTasks,
      skippedOptionalTasks,
      failedOptionalTasks,
      artifactIds: [],
      completedAt: new Date().toISOString(),
    };

    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { status: "completed", completedAt: new Date(), completionSummaryJson: summary as object },
    });

    await this.events.record({
      id: `${workflowId}.workflow.completed`,
      type: "workflow.completed",
      workflowId,
      source: "workflow-service",
      payload: summary,
    });

    return summary;
  }

  async cancel(workflowId: string): Promise<void> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    if (isTerminalWorkflowStatus(workflow.status)) {
      return;
    }

    await this.transitionStatus(workflowId, "cancelled", { type: "workflow.cancelled" });

    const cancellableTasks = await this.prisma.task.findMany({
      where: { workflowId, status: { notIn: [...TASK_TERMINAL_STATUSES, "running"] } },
    });
    for (const task of cancellableTasks) {
      await this.prisma.task.update({ where: { id: task.id }, data: { status: "cancelled" } });
      await this.events.record({
        id: `${workflowId}.${task.id}.task.cancelled`,
        type: "task.cancelled",
        workflowId,
        taskId: task.id,
        source: "workflow-service",
        payload: { reason: "workflow_cancelled" },
      });
    }

    await this.prisma.taskLease.updateMany({
      where: { task: { workflowId }, status: "active" },
      data: { status: "cancelled", releasedAt: new Date() },
    });
  }

  async getFailureDetails(workflowId: string): Promise<WorkflowFailure | null> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    return (workflow.failureDetailsJson as unknown as WorkflowFailure | null) ?? null;
  }

  async getCompletionSummary(workflowId: string): Promise<WorkflowCompletionSummary | null> {
    const workflow = await this.prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    return (workflow.completionSummaryJson as unknown as WorkflowCompletionSummary | null) ?? null;
  }

  async recordRepositoryProfile(
    workflowId: string,
    profile: {
      repositoryProfile: RepositoryProfile;
      baseCommitSha: string;
      workflowBranch: string;
      workspacePath: string;
    },
  ): Promise<void> {
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        repositoryProfileJson: profile.repositoryProfile as object,
        baseCommitSha: profile.baseCommitSha,
        workflowBranch: profile.workflowBranch,
        workspacePath: profile.workspacePath,
      },
    });
  }

  private async toSummary(workflowId: string): Promise<WorkflowSummary> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const grouped = await this.prisma.task.groupBy({
      by: ["status"],
      where: { workflowId },
      _count: { status: true },
    });
    const taskTotals: Record<TaskStatus, number> = {} as Record<TaskStatus, number>;
    for (const group of grouped) {
      taskTotals[group.status as TaskStatus] = group._count.status;
    }

    const activeLeases = await this.prisma.taskLease.count({
      where: { task: { workflowId }, status: "active" },
    });

    const retryCount = await this.prisma.taskAttempt.count({
      where: { task: { workflowId }, attemptType: { in: ["retry", "remediation"] } },
    });

    return {
      workflowId: workflow.id,
      name: workflow.name,
      status: workflow.status,
      manifestHash: workflow.manifestHash,
      baseCommitSha: workflow.baseCommitSha,
      taskTotals,
      activeLeases,
      retryCount,
      latestErrors: workflow.failureMessage ? [workflow.failureMessage] : [],
      createdAt: workflow.createdAt.toISOString(),
      startedAt: workflow.startedAt?.toISOString() ?? null,
      completedAt: workflow.completedAt?.toISOString() ?? null,
      failedAt: workflow.failedAt?.toISOString() ?? null,
      cancelledAt: workflow.cancelledAt?.toISOString() ?? null,
      completionSummary: (workflow.completionSummaryJson as unknown as WorkflowCompletionSummary | null) ?? undefined,
      failureDetails: (workflow.failureDetailsJson as unknown as WorkflowFailure | null) ?? undefined,
    };
  }
}
