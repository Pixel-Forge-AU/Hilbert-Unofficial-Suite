import Fastify, { type FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { createPrismaClient, type PrismaClient } from "@implementation-orchestrator/database";
import { WorkflowService, TaskService, EventService } from "@implementation-orchestrator/orchestrator-core";
import { loadConfig } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { workflowRoutes } from "./routes/workflows.js";
import { metricsRoutes } from "./routes/metrics.js";
import { openApiRoutes } from "./routes/openapi.js";

export interface BuildAppOptions {
  prisma?: PrismaClient;
  jobQueue?: Pick<Queue, "add" | "close">;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig();
  const prisma = options.prisma ?? createPrismaClient(config.databaseUrl || undefined);
  const ownsQueue = !options.jobQueue;
  const jobQueue =
    options.jobQueue ??
    new Queue("orchestrator-jobs", {
      connection: new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
    });

  const app = Fastify({ logger: options.logger ?? true });

  app.decorate("prisma", prisma);
  app.decorate("jobQueue", jobQueue);
  app.decorate("workflowService", new WorkflowService(prisma));
  app.decorate("taskService", new TaskService(prisma));
  app.decorate("eventService", new EventService(prisma));

  app.addHook("onClose", async () => {
    if (ownsQueue) {
      await jobQueue.close();
    }
    await prisma.$disconnect();
  });

  await app.register(healthRoutes);
  await app.register(workflowRoutes, { prefix: "/v1" });
  await app.register(metricsRoutes);
  await app.register(openApiRoutes);

  return app;
}
