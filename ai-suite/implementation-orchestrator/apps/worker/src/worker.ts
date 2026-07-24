import { Queue, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import pino from "pino";
import { createPrismaClient } from "@implementation-orchestrator/database";
import { loadConfig } from "./config.js";
import { buildProcessorRegistry, createRouter } from "./processors/index.js";
import { startMetricsServer } from "./metrics-server.js";
import type { JobEnqueuer } from "./job-enqueuer.js";

const logger = pino({ name: "orchestrator-worker" });

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl || undefined);
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const producerQueue = new Queue("orchestrator-jobs", { connection });
  const jobEnqueuer: JobEnqueuer = {
    enqueue: async (name, data, jobId) => {
      await producerQueue.add(name, data, { jobId });
    },
  };

  const registry = buildProcessorRegistry(prisma, config, jobEnqueuer);
  const route = createRouter(registry);

  const worker = new Worker("orchestrator-jobs", route, { connection, concurrency: 4 });
  const metricsServer = startMetricsServer(config.metricsPort);

  await producerQueue.add(
    "lease.sweep",
    {},
    { repeat: { every: config.leaseSweepIntervalMs }, jobId: "lease-sweep-repeatable" },
  );
  await producerQueue.add(
    "retry.sweep",
    {},
    { repeat: { every: config.retrySweepIntervalMs }, jobId: "retry-sweep-repeatable" },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: error }, "job failed");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down worker");
    await worker.close();
    await producerQueue.close();
    await connection.quit();
    await prisma.$disconnect();
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("worker started");
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed to start");
  process.exit(1);
});
