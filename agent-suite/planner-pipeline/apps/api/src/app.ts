import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@planner/database";
import { renderMetrics } from "@planner/observability";
import { PlannerOrchestrator } from "@planner/planner-core";
import { ZodError } from "zod";
import { registerPlanRoutes } from "./routes/plans.js";
import { createPlanQueue } from "./queue.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const validationError = error as ZodError;
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: validationError.flatten()
        }
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected server error occurred."
      }
    });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Planner Service API",
        version: "0.1.0"
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const orchestrator = new PlannerOrchestrator({ prisma, logger: app.log });
  const queue = createPlanQueue();
  app.addHook("onClose", async () => {
    await queue.close();
    await prisma.$disconnect();
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/metrics", async (_request, reply) => {
    const { contentType, body } = await renderMetrics();
    return reply.type(contentType).send(body);
  });
  await registerPlanRoutes(app, { prisma, orchestrator, queue });
  return app;
}
