import type { Queue } from "bullmq";
import type { PrismaClient } from "@implementation-orchestrator/database";
import type {
  EventService,
  WorkflowService,
  TaskService,
} from "@implementation-orchestrator/orchestrator-core";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    jobQueue: Pick<Queue, "add" | "close">;
    workflowService: WorkflowService;
    taskService: TaskService;
    eventService: EventService;
  }
}
