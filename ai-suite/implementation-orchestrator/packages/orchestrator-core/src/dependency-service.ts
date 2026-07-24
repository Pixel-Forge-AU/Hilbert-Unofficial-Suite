import type { PrismaClient } from "@implementation-orchestrator/database";
import { TaskService } from "./task-service.js";

export class DependencyService {
  private readonly taskService: TaskService;

  constructor(private readonly prisma: PrismaClient) {
    this.taskService = new TaskService(prisma);
  }

  async computeInitialReadiness(workflowId: string): Promise<void> {
    const pendingTasks = await this.prisma.task.findMany({
      where: { workflowId, status: "pending" },
    });

    for (const task of pendingTasks) {
      const hardDependencyCount = await this.prisma.taskDependency.count({
        where: { workflowId, fromTaskId: task.id, dependencyType: "hard" },
      });

      if (hardDependencyCount === 0) {
        await this.taskService.transitionTask(task.id, "ready", { type: "task.ready" });
      } else {
        await this.taskService.transitionTask(task.id, "blocked", { type: "task.blocked" });
      }
    }
  }

  async recheckAfterAcceptance(workflowId: string, acceptedTaskId: string): Promise<void> {
    const dependents = await this.prisma.taskDependency.findMany({
      where: { workflowId, toTaskId: acceptedTaskId, dependencyType: "hard" },
      select: { fromTaskId: true },
    });

    for (const { fromTaskId } of dependents) {
      const dependentTask = await this.prisma.task.findUnique({ where: { id: fromTaskId } });
      if (!dependentTask || dependentTask.status !== "blocked") {
        continue;
      }

      const allSatisfied = await this.allHardDependenciesAccepted(workflowId, fromTaskId);
      if (allSatisfied) {
        await this.taskService.transitionTask(fromTaskId, "ready", { type: "task.ready" });
      }
    }
  }

  private async allHardDependenciesAccepted(workflowId: string, taskId: string): Promise<boolean> {
    const hardDependencies = await this.prisma.taskDependency.findMany({
      where: { workflowId, fromTaskId: taskId, dependencyType: "hard" },
      select: { toTaskId: true },
    });
    if (hardDependencies.length === 0) {
      return true;
    }

    const targetIds = hardDependencies.map((d) => d.toTaskId);
    const acceptedCount = await this.prisma.task.count({
      where: { id: { in: targetIds }, status: "accepted" },
    });
    return acceptedCount === targetIds.length;
  }
}
