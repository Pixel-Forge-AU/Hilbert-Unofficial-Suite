import { Prisma, type PrismaClient } from "@implementation-orchestrator/database";
import {
  isValidTaskTransition,
  type TaskFilter,
  type TaskStatus,
  type TaskSummary,
  type WorkflowEventType,
} from "@implementation-orchestrator/contracts";
import { EventService } from "./event-service.js";

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidTaskTransitionError extends Error {
  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition for "${taskId}": ${from} -> ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

const TIMESTAMP_FIELD_BY_STATUS: Partial<Record<TaskStatus, "readyAt" | "acceptedAt" | "failedAt">> = {
  ready: "readyAt",
  accepted: "acceptedAt",
  failed: "failedAt",
};

export interface TaskTransitionExtraData {
  retryEligibleAt?: Date | null;
  remediationInstructionJson?: object | null;
}

export class TaskService {
  private readonly events: EventService;

  constructor(private readonly prisma: PrismaClient) {
    this.events = new EventService(prisma);
  }

  async listTasks(workflowId: string, filter: TaskFilter = {}): Promise<TaskSummary[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        workflowId,
        status: filter.status as TaskStatus | undefined,
        phaseId: filter.phaseId,
        builderProfile: filter.builderProfile,
        priority: filter.priority,
      },
      orderBy: { createdAt: "asc" },
    });
    return rows
      .filter((row) => !filter.featureId || this.contractIncludesFeature(row.contractJson, filter.featureId))
      .map((row) => this.toSummary(row));
  }

  async getTask(workflowId: string, taskId: string): Promise<TaskSummary> {
    const row = await this.prisma.task.findFirst({ where: { workflowId, id: taskId } });
    if (!row) {
      throw new TaskNotFoundError(taskId);
    }
    return this.toSummary(row);
  }

  async transitionTask(
    taskId: string,
    to: TaskStatus,
    event?: { type: WorkflowEventType; payload?: unknown },
    extraData?: TaskTransitionExtraData,
  ): Promise<void> {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const from = task.status;
    if (from === to) {
      return;
    }
    if (!isValidTaskTransition(from, to)) {
      throw new InvalidTaskTransitionError(taskId, from, to);
    }

    const timestampField = TIMESTAMP_FIELD_BY_STATUS[to];
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        ...(extraData?.retryEligibleAt !== undefined ? { retryEligibleAt: extraData.retryEligibleAt } : {}),
        ...(extraData?.remediationInstructionJson !== undefined
          ? { remediationInstructionJson: extraData.remediationInstructionJson ?? Prisma.JsonNull }
          : {}),
      },
    });

    if (event) {
      await this.events.record({
        id: `${task.workflowId}.${task.id}.${event.type}`,
        type: event.type,
        workflowId: task.workflowId,
        taskId: task.id,
        source: "task-service",
        payload: event.payload ?? {},
      });
    }
  }

  private contractIncludesFeature(contractJson: unknown, featureId: string): boolean {
    const contract = contractJson as { sourceFeatureIds?: string[] } | null;
    return Boolean(contract?.sourceFeatureIds?.includes(featureId));
  }

  private toSummary(row: {
    id: string;
    workflowId: string;
    status: string;
    phaseId: string;
    title: string;
    category: string;
    priority: string;
    builderProfile: string;
    contractJson: unknown;
    createdAt: Date;
    updatedAt: Date;
    readyAt: Date | null;
    acceptedAt: Date | null;
    failedAt: Date | null;
  }): TaskSummary {
    const contract = row.contractJson as { dependencies?: string[] } | null;
    return {
      id: row.id,
      workflowId: row.workflowId,
      status: row.status as TaskSummary["status"],
      phaseId: row.phaseId,
      title: row.title,
      category: row.category as TaskSummary["category"],
      priority: row.priority as TaskSummary["priority"],
      builderProfile: row.builderProfile,
      dependencies: contract?.dependencies ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      readyAt: row.readyAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
    };
  }
}
