import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@planner/database";
import {
  PLANNER_STAGE_NAMES,
  addPlanInstructionRequestSchema,
  createPlanRequestSchema,
  plannerStageNameSchema
} from "@planner/contracts";
import type { PlannerOrchestrator } from "@planner/planner-core";

interface RouteDeps {
  prisma: PrismaClient;
  orchestrator: PlannerOrchestrator;
  queue: Queue<{ planId: string }>;
}

export async function registerPlanRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post("/v1/plans", async (request, reply) => {
    const body = createPlanRequestSchema.parse(request.body);
    const response = await deps.orchestrator.createPlan(body);
    await deps.queue.add("run-plan", { planId: response.planId }, { jobId: response.planId });
    return reply.code(202).send(response);
  });

  app.get("/v1/plans/:planId", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await deps.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return reply.code(404).send(error("PLAN_NOT_FOUND", `Plan ${planId} was not found.`));
    const completed = await deps.prisma.stageExecution.findMany({
      where: { planId, status: "completed" },
      distinct: ["stageName"],
      orderBy: { completedAt: "asc" }
    });
    const completedStages = completed
      .map((stage) => plannerStageNameSchema.safeParse(stage.stageName))
      .filter((result) => result.success)
      .map((result) => result.data);
    return {
      planId: plan.id,
      title: plan.title,
      status: plan.status,
      currentStage: plan.currentStage,
      progressPercentage: Math.round((completedStages.length / PLANNER_STAGE_NAMES.length) * 100),
      completedStages,
      latestQualityScore: plan.qualityScore,
      revisionCycle: plan.revisionCycle,
      maxRevisionCycles: plan.maxRevisionCycles,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      completedAt: plan.completedAt?.toISOString() ?? null,
      failure:
        plan.failureCode || plan.failureMessage
          ? { code: plan.failureCode, message: plan.failureMessage }
          : null
    };
  });

  app.get("/v1/plans/:planId/manifest", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const accept = request.headers.accept ?? "application/json";
    const artifactType = accept.includes("text/markdown")
      ? "manifest_markdown"
      : accept.includes("yaml")
        ? "manifest_yaml"
        : "manifest_json";
    const artifact = await deps.prisma.planArtifact.findFirst({
      where: { planId, artifactType },
      orderBy: { version: "desc" }
    });
    if (!artifact) return reply.code(404).send(error("MANIFEST_NOT_FOUND", "No manifest is available yet."));
    return reply.type(artifact.format).send(artifact.content);
  });

  app.get("/v1/plans/:planId/stages/:stageName", async (request, reply) => {
    const { planId, stageName } = request.params as { planId: string; stageName: string };
    const parsedStage = plannerStageNameSchema.safeParse(stageName);
    if (!parsedStage.success) return reply.code(400).send(error("INVALID_STAGE", "Unknown stage name."));
    const stage = await deps.prisma.stageExecution.findFirst({
      where: { planId, stageName: parsedStage.data },
      orderBy: { createdAt: "desc" }
    });
    if (!stage) return reply.code(404).send(error("STAGE_NOT_FOUND", "No execution found for this stage."));
    return {
      planId,
      stageName: parsedStage.data,
      status: stage.status,
      attempt: stage.attempt,
      output: stage.outputJson,
      summary: stage.summaryJson,
      completedAt: stage.completedAt?.toISOString() ?? null
    };
  });

  app.post("/v1/plans/:planId/cancel", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    await deps.queue.remove(planId);
    const plan = await deps.prisma.plan.update({
      where: { id: planId },
      data: { status: "cancelled", completedAt: new Date() }
    });
    return reply.send({ planId: plan.id, status: "cancelled" });
  });

  app.post("/v1/plans/:planId/pause", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await deps.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return reply.code(404).send(error("PLAN_NOT_FOUND", `Plan ${planId} was not found.`));
    if (plan.status !== "running" && plan.status !== "queued") {
      return reply.code(409).send(error("PLAN_NOT_PAUSABLE", `Plan is "${plan.status}", not running or queued.`));
    }
    // Removes the job if it hasn't started yet; if it's already executing, this only flips
    // the DB status - the orchestrator's own between-stage check (see orchestrator.ts) is
    // what actually stops it, without aborting whatever stage is currently in flight.
    await deps.queue.remove(planId);
    const updated = await deps.prisma.plan.update({ where: { id: planId }, data: { status: "paused" } });
    return reply.send({ planId: updated.id, status: "paused" });
  });

  app.post("/v1/plans/:planId/resume", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await deps.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return reply.code(404).send(error("PLAN_NOT_FOUND", `Plan ${planId} was not found.`));
    if (plan.status !== "paused") {
      return reply.code(409).send(error("PLAN_NOT_PAUSED", `Plan is "${plan.status}", not paused.`));
    }
    await deps.prisma.plan.update({ where: { id: planId }, data: { status: "queued" } });
    await deps.queue.add("run-plan", { planId }, { jobId: `${planId}:resume:${Date.now()}` });
    return reply.code(202).send({ planId, status: "queued" });
  });

  app.post("/v1/plans/:planId/retry", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    await deps.prisma.plan.update({
      where: { id: planId },
      data: { status: "queued", failureCode: null, failureMessage: null, completedAt: null }
    });
    await deps.queue.add("run-plan", { planId }, { jobId: `${planId}:retry:${Date.now()}` });
    return reply.code(202).send({ planId, status: "queued" });
  });

  app.post("/v1/plans/:planId/publish", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await deps.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return reply.code(404).send(error("PLAN_NOT_FOUND", `Plan ${planId} was not found.`));
    if (plan.status !== "passed") {
      return reply.code(409).send(error("PLAN_NOT_PASSED", "Plan has not reached status \"passed\" yet."));
    }
    if (!plan.implementationTargetJson) {
      return reply.code(400).send(error("NO_IMPLEMENTATION_TARGET", "Plan was created without an implementationTarget."));
    }
    if (plan.implementationPublishStatus === "published") {
      return reply
        .code(409)
        .send(error("ALREADY_PUBLISHED", `Already published as workflow ${plan.implementationWorkflowId}.`));
    }
    await deps.orchestrator.publishPlan(planId);
    const updated = await deps.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    return reply.code(202).send({
      planId,
      status: updated.implementationPublishStatus ?? "pending",
      workflowId: updated.implementationWorkflowId
    });
  });

  app.post("/v1/plans/:planId/instructions", async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const body = addPlanInstructionRequestSchema.parse(request.body);
    await deps.orchestrator.addInstruction(planId, body.instruction, body.rerunFromStage);
    await deps.queue.add("run-plan", { planId }, { jobId: `${planId}:instruction:${Date.now()}` });
    return reply.code(202).send({ planId, status: "awaiting_revision", rerunFromStage: body.rerunFromStage });
  });
}

function error(code: string, message: string) {
  return { error: { code, message } };
}
