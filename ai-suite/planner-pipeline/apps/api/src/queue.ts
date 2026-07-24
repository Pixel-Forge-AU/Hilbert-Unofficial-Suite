import { Queue } from "bullmq";

export const PLAN_QUEUE_NAME = "planner-jobs";

export function createQueueConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined
  };
}

export function createPlanQueue(): Queue<{ planId: string }> {
  return new Queue(PLAN_QUEUE_NAME, {
    connection: createQueueConnection()
  });
}
