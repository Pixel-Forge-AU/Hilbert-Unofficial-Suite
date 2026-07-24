import { Worker } from "bullmq";
import pino from "pino";
import { prisma } from "@planner/database";
import { PlannerOrchestrator } from "@planner/planner-core";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const stageTimeoutMs = Number(process.env.PLANNER_STAGE_TIMEOUT_MS ?? 300_000);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined
};
const orchestrator = new PlannerOrchestrator({ prisma, logger });

const worker = new Worker<{ planId: string }>(
  "planner-jobs",
  async (job) => {
    logger.info({ planId: job.data.planId, jobId: job.id }, "Starting planner job");
    await orchestrator.runPlan(job.data.planId);
  },
  {
    connection,
    concurrency: Number(process.env.PLANNER_WORKER_CONCURRENCY ?? 1),
    lockDuration: Number(process.env.PLANNER_WORKER_LOCK_DURATION_MS ?? Math.min(stageTimeoutMs, 300_000)),
    stalledInterval: Number(process.env.PLANNER_WORKER_STALLED_INTERVAL_MS ?? 60_000),
    maxStalledCount: Number(process.env.PLANNER_WORKER_MAX_STALLED_COUNT ?? 3)
  }
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id, planId: job.data.planId }, "Planner job completed");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, planId: job?.data.planId, err: error }, "Planner job failed");
  if (job?.data.planId) {
    void markPlanFailedAfterWorkerFailure(job.data.planId, error).catch((markError) => {
      logger.error({ planId: job.data.planId, err: markError }, "Failed to mark stalled planner job as failed");
    });
  }
});

async function markPlanFailedAfterWorkerFailure(planId: string, error: Error): Promise<void> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { status: true, currentStage: true }
  });
  if (!plan || plan.status !== "running") return;

  const message = error.message || "Worker job failed before the orchestrator could finish.";
  if (plan.currentStage) {
    const runningStage = await prisma.stageExecution.findFirst({
      where: { planId, stageName: plan.currentStage, status: "running" },
      orderBy: { createdAt: "desc" }
    });
    if (runningStage) {
      const durationMs = Date.now() - runningStage.createdAt.getTime();
      await prisma.stageExecution.update({
        where: { id: runningStage.id },
        data: {
          status: "failed",
          errorJson: { message },
          durationMs,
          completedAt: new Date()
        }
      });
    }
  }

  await prisma.plan.update({
    where: { id: planId },
    data: {
      status: "failed",
      failureCode: "WORKER_JOB_FAILED",
      failureMessage: `${plan.currentStage ?? "unknown_stage"}: ${message}`
    }
  });
}

async function shutdown(): Promise<void> {
  await worker.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
