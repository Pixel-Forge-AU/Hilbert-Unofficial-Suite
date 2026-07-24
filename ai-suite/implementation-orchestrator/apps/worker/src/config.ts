import path from "node:path";
import os from "node:os";

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  workspaceRoot: string;
  artifactStoragePath: string;
  leaseSweepIntervalMs: number;
  retrySweepIntervalMs: number;
  taskPollIntervalMs: number;
  metricsPort: number;
  openHands: {
    baseUrl?: string;
    sessionApiKey?: string;
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmUsageId?: string;
    containerWorkspaceRoot?: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? "",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    logLevel: env.LOG_LEVEL ?? "info",
    workspaceRoot: env.WORKSPACE_ROOT ?? path.join(os.tmpdir(), "implementation-orchestrator-workspaces"),
    artifactStoragePath: env.ARTIFACT_STORAGE_PATH ?? path.join(os.tmpdir(), "implementation-orchestrator-artifacts"),
    leaseSweepIntervalMs: Number(env.LEASE_SWEEP_INTERVAL_MS ?? 30_000),
    retrySweepIntervalMs: Number(env.RETRY_SWEEP_INTERVAL_MS ?? 15_000),
    taskPollIntervalMs: Number(env.TASK_POLL_INTERVAL_MS ?? 2000),
    metricsPort: Number(env.METRICS_PORT ?? 9465),
    openHands: {
      baseUrl: env.OPENHANDS_BASE_URL,
      sessionApiKey: env.OPENHANDS_SESSION_API_KEY,
      llmModel: env.OPENHANDS_LLM_MODEL,
      llmApiKey: env.OPENHANDS_LLM_API_KEY,
      llmBaseUrl: env.OPENHANDS_LLM_BASE_URL,
      llmUsageId: env.OPENHANDS_LLM_USAGE_ID,
      containerWorkspaceRoot: env.OPENHANDS_CONTAINER_WORKSPACE_ROOT,
    },
  };
}
