import type { PrismaClient } from "@implementation-orchestrator/database";
import type { TaskStatus } from "@implementation-orchestrator/contracts";

export class TaskNotReadyError extends Error {
  constructor(taskId: string, actualStatus: string) {
    super(`Task "${taskId}" cannot be leased because it is "${actualStatus}", not "ready".`);
    this.name = "TaskNotReadyError";
  }
}

export class LeaseAlreadyActiveError extends Error {
  constructor(taskId: string) {
    super(`Task "${taskId}" already has an active lease.`);
    this.name = "LeaseAlreadyActiveError";
  }
}

export interface AcquiredLease {
  id: string;
  taskId: string;
  builderId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface ExpiredLeaseWithTask {
  leaseId: string;
  taskId: string;
  taskStatus: TaskStatus;
  workflowId: string;
}

export class LeaseService {
  constructor(private readonly prisma: PrismaClient) {}

  async acquireLease(taskId: string, builderId: string, leaseDurationSeconds: number): Promise<AcquiredLease> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM tasks WHERE id = ${taskId} FOR UPDATE
      `;
      const task = rows[0];
      if (!task) {
        throw new TaskNotReadyError(taskId, "missing");
      }
      if (task.status !== "ready") {
        throw new TaskNotReadyError(taskId, task.status);
      }

      const existingActive = await tx.taskLease.findFirst({ where: { taskId, status: "active" } });
      if (existingActive) {
        throw new LeaseAlreadyActiveError(taskId);
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + leaseDurationSeconds * 1000);
      const lease = await tx.taskLease.create({
        data: { taskId, builderId, status: "active", acquiredAt: now, expiresAt, lastHeartbeatAt: now },
      });

      await tx.task.update({ where: { id: taskId }, data: { status: "leased" } });

      return { id: lease.id, taskId, builderId, acquiredAt: now, expiresAt };
    });
  }

  async heartbeat(leaseId: string, extendBySeconds?: number): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.taskLease.updateMany({
      where: { id: leaseId, status: "active" },
      data: {
        lastHeartbeatAt: now,
        ...(extendBySeconds ? { expiresAt: new Date(now.getTime() + extendBySeconds * 1000) } : {}),
      },
    });
    return result.count > 0;
  }

  async release(leaseId: string): Promise<boolean> {
    const result = await this.prisma.taskLease.updateMany({
      where: { id: leaseId, status: "active" },
      data: { status: "released", releasedAt: new Date() },
    });
    return result.count > 0;
  }

  async findExpiredActiveLeases(): Promise<ExpiredLeaseWithTask[]> {
    const rows = await this.prisma.taskLease.findMany({
      where: { status: "active", expiresAt: { lt: new Date() } },
      include: { task: true },
    });
    return rows.map((row) => ({
      leaseId: row.id,
      taskId: row.taskId,
      taskStatus: row.task.status,
      workflowId: row.task.workflowId,
    }));
  }

  async markExpired(leaseId: string): Promise<boolean> {
    const result = await this.prisma.taskLease.updateMany({
      where: { id: leaseId, status: "active" },
      data: { status: "expired" },
    });
    return result.count > 0;
  }
}
