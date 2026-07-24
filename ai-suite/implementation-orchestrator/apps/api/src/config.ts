export interface ApiConfig {
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? "",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
