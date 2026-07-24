import type { FastifyInstance } from "fastify";
import {
  CreateWorkflowRequestSchema,
  TaskFilterSchema,
} from "@implementation-orchestrator/contracts";
import { WorkflowNotFoundError, TaskNotFoundError } from "@implementation-orchestrator/orchestrator-core";
import { workflowsTotal } from "@implementation-orchestrator/observability";

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.post("/workflows", async (request, reply) => {
    const parsed = CreateWorkflowRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const summary = await app.workflowService.createWorkflow(parsed.data);
    workflowsTotal.inc();

    const eventId = `${summary.workflowId}.workflow.created`;
    await app.jobQueue.add(
      "event.record",
      {
        id: eventId,
        type: "workflow.created",
        workflowId: summary.workflowId,
        source: "workflow-service",
        payload: { manifestHash: summary.manifestHash, name: summary.name },
      },
      { jobId: eventId },
    );

    await app.jobQueue.add(
      "workflow.process",
      { workflowId: summary.workflowId },
      { jobId: `${summary.workflowId}.workflow.process` },
    );

    return reply.status(201).send({ workflowId: summary.workflowId, status: summary.status });
  });

  app.get("/workflows", async () => {
    return app.workflowService.listWorkflows();
  });

  app.get<{ Params: { workflowId: string } }>("/workflows/:workflowId", async (request, reply) => {
    try {
      return await app.workflowService.getWorkflow(request.params.workflowId);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return reply.status(404).send({ error: "workflow_not_found" });
      }
      throw error;
    }
  });

  app.get<{ Params: { workflowId: string }; Querystring: Record<string, string> }>(
    "/workflows/:workflowId/tasks",
    async (request, reply) => {
      const parsedFilter = TaskFilterSchema.safeParse(request.query);
      if (!parsedFilter.success) {
        return reply.status(400).send({ error: "invalid_query", details: parsedFilter.error.flatten() });
      }
      try {
        await app.workflowService.getWorkflow(request.params.workflowId);
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          return reply.status(404).send({ error: "workflow_not_found" });
        }
        throw error;
      }
      return app.taskService.listTasks(request.params.workflowId, parsedFilter.data);
    },
  );

  app.get<{ Params: { workflowId: string; taskId: string } }>(
    "/workflows/:workflowId/tasks/:taskId",
    async (request, reply) => {
      try {
        return await app.taskService.getTask(request.params.workflowId, request.params.taskId);
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return reply.status(404).send({ error: "task_not_found" });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { workflowId: string } }>("/workflows/:workflowId/cancel", async (request, reply) => {
    try {
      await app.workflowService.getWorkflow(request.params.workflowId);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return reply.status(404).send({ error: "workflow_not_found" });
      }
      throw error;
    }
    await app.workflowService.cancel(request.params.workflowId);
    return app.workflowService.getWorkflow(request.params.workflowId);
  });

  app.get<{ Params: { workflowId: string } }>("/workflows/:workflowId/artifacts", async (request, reply) => {
    try {
      await app.workflowService.getWorkflow(request.params.workflowId);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return reply.status(404).send({ error: "workflow_not_found" });
      }
      throw error;
    }
    const artifacts = await app.prisma.artifact.findMany({
      where: { workflowId: request.params.workflowId },
      orderBy: { createdAt: "asc" },
    });
    return artifacts;
  });
}
