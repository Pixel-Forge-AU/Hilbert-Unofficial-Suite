import type { PrismaClient } from "@implementation-orchestrator/database";
import type { CreateEventRequest, WorkflowEvent } from "@implementation-orchestrator/contracts";

export interface RecordedEvent {
  id: string;
  type: string;
  workflowId: string;
  taskId: string | null;
  attemptId: string | null;
  occurredAt: string;
  source: string;
  payload: unknown;
  wasNew: boolean;
}

export class EventService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(event: CreateEventRequest): Promise<RecordedEvent> {
    const existing = await this.prisma.workflowEvent.findUnique({ where: { id: event.id } });
    if (existing) {
      return {
        id: existing.id,
        type: existing.eventType,
        workflowId: existing.workflowId,
        taskId: existing.taskId,
        attemptId: existing.attemptId,
        occurredAt: existing.occurredAt.toISOString(),
        source: existing.source,
        payload: existing.payloadJson,
        wasNew: false,
      };
    }

    const occurredAt = event.occurredAt ?? new Date().toISOString();
    const created = await this.prisma.workflowEvent.create({
      data: {
        id: event.id,
        eventType: event.type,
        workflowId: event.workflowId,
        taskId: event.taskId ?? null,
        attemptId: event.attemptId ?? null,
        occurredAt: new Date(occurredAt),
        source: event.source,
        payloadJson: (event.payload ?? {}) as object,
      },
    });

    return {
      id: created.id,
      type: created.eventType,
      workflowId: created.workflowId,
      taskId: created.taskId,
      attemptId: created.attemptId,
      occurredAt: created.occurredAt.toISOString(),
      source: created.source,
      payload: created.payloadJson,
      wasNew: true,
    };
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowEvent[]> {
    const rows = await this.prisma.workflowEvent.findMany({
      where: { workflowId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.eventType as WorkflowEvent["type"],
      workflowId: row.workflowId,
      taskId: row.taskId ?? undefined,
      attemptId: row.attemptId ?? undefined,
      occurredAt: row.occurredAt.toISOString(),
      source: row.source,
      payload: row.payloadJson,
    }));
  }
}
