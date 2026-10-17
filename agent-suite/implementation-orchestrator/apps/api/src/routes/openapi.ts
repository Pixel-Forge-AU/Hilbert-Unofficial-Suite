import type { FastifyInstance } from "fastify";
import { openApiDocument } from "../openapi-document.js";

export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/openapi.json", async () => openApiDocument);
}
