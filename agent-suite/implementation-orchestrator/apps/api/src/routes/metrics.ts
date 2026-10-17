import type { FastifyInstance } from "fastify";
import { METRICS_CONTENT_TYPE, renderMetrics } from "@implementation-orchestrator/observability";

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", METRICS_CONTENT_TYPE);
    return renderMetrics();
  });
}
