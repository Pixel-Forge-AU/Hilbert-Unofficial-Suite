import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  buildManifestSchema,
  type CompilerSynthesis,
  type CreatePlanRequest,
  type FeatureExpansion,
  type ScopePlan,
  type VisualDirection
} from "@planner/contracts";
import { PrismaClient } from "@planner/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PlannerOrchestrator } from "../src/orchestrator.js";
import { FakeLlmProvider } from "./fixtures/fake-llm-provider.js";
import { failingCritique, VALID_STAGE_OUTPUTS } from "./fixtures/valid-stage-outputs.js";

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(currentDir, "../../database/prisma/schema.prisma");
const prismaCli = path.resolve(currentDir, "../../database/node_modules/prisma/build/index.js");

interface SilentLogger {
  info: () => void;
  warn: () => void;
  error: () => void;
  child: () => SilentLogger;
}

const silentLogger: SilentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger
};

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe"
  });
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

function baseRequest(overrides: Partial<CreatePlanRequest["preferences"]> = {}): CreatePlanRequest {
  return {
    title: "Searchable 3D parts library",
    brief: "Build a searchable parts library for a 3D printing business.",
    constraints: ["Must integrate with WordPress", "Must support more than 5000 parts"],
    preferences: {
      strictness: 9,
      creativity: 9,
      detailLevel: 10,
      targetQualityScore: 92,
      maxRevisionCycles: 4,
      ...overrides
    },
    context: { existingStack: ["WordPress"], existingSystems: [], referenceNotes: [] }
  };
}

async function stageRows(planId: string, stageName: string) {
  return prisma.stageExecution.findMany({ where: { planId, stageName }, orderBy: { attempt: "asc" } });
}

describe("PlannerOrchestrator integration (real Postgres via Testcontainers)", () => {
  it("runs a plan to completion end-to-end with a fully valid provider", async () => {
    const provider = new FakeLlmProvider();
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.qualityScore).toBe(93);
    expect(plan.revisionCycle).toBe(0);

    const manifestArtifact = await prisma.planArtifact.findFirstOrThrow({
      where: { planId, artifactType: "manifest_json" }
    });
    expect(buildManifestSchema.safeParse(JSON.parse(manifestArtifact.content)).success).toBe(true);
  });

  it("marks a stage invalid_output when the model can never produce schema-valid JSON", async () => {
    const provider = new FakeLlmProvider();
    provider.setDefault("edge_case_hunter", { kind: "text", text: JSON.stringify({ findings: [] }) });
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await expect(orchestrator.runPlan(planId)).rejects.toThrow();

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("failed");
    expect(plan.failureCode).toBe("STAGE_INVALID_OUTPUT");

    const [execution] = await stageRows(planId, "edge_case_hunter");
    expect(execution?.status).toBe("invalid_output");
  });

  it("marks a stage failed when the provider times out persistently", async () => {
    const provider = new FakeLlmProvider();
    provider.setDefault("systems_architect", {
      kind: "error",
      error: new Error("ETIMEDOUT: request to LLM endpoint timed out")
    });
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await expect(orchestrator.runPlan(planId)).rejects.toThrow(/ETIMEDOUT/);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("failed");
    expect(plan.failureCode).toBe("STAGE_FAILED");
    expect(plan.failureMessage).toContain("systems_architect");

    const [execution] = await stageRows(planId, "systems_architect");
    expect(execution?.status).toBe("failed");
  });

  it("resumes after a worker restart without redoing completed stages", async () => {
    const crashingProvider = new FakeLlmProvider();
    crashingProvider.setDefault("feature_expander", { kind: "error", error: new Error("simulated worker crash") });
    const firstWorker = new PlannerOrchestrator({ prisma, logger: silentLogger, provider: crashingProvider });
    const { planId } = await firstWorker.createPlan(baseRequest());

    await expect(firstWorker.runPlan(planId)).rejects.toThrow("simulated worker crash");

    for (const stage of ["intent_interpreter", "concept_generator", "creative_director"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("completed");
    }

    const secondWorker = new PlannerOrchestrator({ prisma, logger: silentLogger, provider: new FakeLlmProvider() });
    await secondWorker.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");

    for (const stage of ["intent_interpreter", "concept_generator", "creative_director"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.attempt).toBe(1);
    }
    const featureExpanderRows = await stageRows(planId, "feature_expander");
    expect(featureExpanderRows).toHaveLength(2);
    expect(featureExpanderRows[1]?.status).toBe("completed");
  });

  it("fails immediately when the quality gate is not met and no revisions are allowed", async () => {
    const provider = new FakeLlmProvider();
    provider.setDefault("plan_critic", { kind: "value", value: failingCritique });
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest({ maxRevisionCycles: 0 }));

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("failed");
    expect(plan.failureCode).toBe("QUALITY_THRESHOLD_NOT_REACHED");
    expect(plan.qualityScore).toBe(failingCritique.overallScore);

    const critique = await prisma.critique.findFirstOrThrow({ where: { planId } });
    expect(critique.passed).toBe(false);
  });

  it("recovers via a targeted revision without rerunning unaffected stages", async () => {
    const provider = new FakeLlmProvider();
    provider.script("plan_critic", [{ response: { kind: "value", value: failingCritique } }]);
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(1);

    for (const stage of ["intent_interpreter", "concept_generator", "creative_director", "feature_expander", "ux_designer"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.attempt).toBe(1);
    }
    for (const stage of ["art_director", "systems_architect", "edge_case_hunter", "scope_challenger", "specification_compiler", "plan_critic"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.status).toBe("completed");
    }
  });

  it("patches a revised stage instead of regenerating it, leaving untouched fields byte-identical", async () => {
    const provider = new FakeLlmProvider();
    provider.script("plan_critic", [{ response: { kind: "value", value: failingCritique } }]);
    const originalVisualDirection = VALID_STAGE_OUTPUTS.art_director as VisualDirection;
    const patchedMotionSystem = {
      personality: "Snappy and precise, calibrated for confident interaction.",
      microInteractionDurationMs: [100, 150],
      panelTransitionDurationMs: [200, 260],
      easingRules: ["Use ease-out for entrances", "Use ease-in for exits"],
      forbiddenMotion: ["No parallax scrolling", "No bouncing loaders"]
    };
    // Patch mode calls generateStructured with schemaName `${stageName}_patch` against a
    // partial schema - scripting only that key (not "art_director") proves the second
    // attempt goes through the patch path rather than falling back to a full regeneration.
    provider.script("art_director_patch", [{ response: { kind: "value", value: { motionSystem: patchedMotionSystem } } }]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(1);

    const artDirectorRows = await stageRows(planId, "art_director");
    expect(artDirectorRows).toHaveLength(2);
    expect(artDirectorRows[0]?.status).toBe("superseded");
    expect(artDirectorRows[1]?.status).toBe("completed");

    const patchedOutput = artDirectorRows[1]?.outputJson as VisualDirection;
    expect(patchedOutput.motionSystem).toEqual(patchedMotionSystem);
    const { motionSystem: _originalMotion, ...restOfOriginal } = originalVisualDirection;
    const { motionSystem: _patchedMotion, ...restOfPatched } = patchedOutput;
    expect(restOfPatched).toEqual(restOfOriginal);
  });

  it("falls back to full regeneration when patch generation fails, instead of failing the stage", async () => {
    const provider = new FakeLlmProvider();
    provider.script("plan_critic", [{ response: { kind: "value", value: failingCritique } }]);
    // Simulate the patch call exhausting its repair budget and throwing (e.g. the model keeps
    // returning array items missing required fields, as qwen3-coder-next did in production on
    // 2026-07-18 - see [[project_ftl_babylonjs_pipeline_run]]) - the fallback should catch this
    // and retry via a full regeneration instead of failing the stage/plan outright.
    provider.script("art_director_patch", [{ response: { kind: "error", error: new Error("schema repair exhausted") } }]);
    const correctedVisualDirection = cloneFixture(VALID_STAGE_OUTPUTS.art_director as VisualDirection);
    correctedVisualDirection.motionSystem.personality = "Corrected via full regeneration fallback.";
    // Queue two steps: the first satisfies art_director's initial (non-revision) generation,
    // the second is what the post-patch-failure fallback call receives.
    provider.script("art_director", [{ response: { kind: "valid" } }, { response: { kind: "value", value: correctedVisualDirection } }]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(1);

    const artDirectorRows = await stageRows(planId, "art_director");
    expect(artDirectorRows).toHaveLength(2);
    expect(artDirectorRows[1]?.status).toBe("completed");
    const finalOutput = artDirectorRows[1]?.outputJson as VisualDirection;
    expect(finalOutput.motionSystem.personality).toBe("Corrected via full regeneration fallback.");
  });

  it("reminds a stage of an older, already-fixed issue when it's revised again for a different reason", async () => {
    const provider = new FakeLlmProvider();
    const secondFailingCritique = cloneFixture(failingCritique);
    secondFailingCritique.majorIssues[0]!.problem = "Colour contrast is unmeasured.";
    secondFailingCritique.revisionRequests[0]!.problem = "Colour contrast is unmeasured.";
    // Two separate cycles, each fixing a *different* art_director issue - the second cycle's
    // patch prompt should still carry a reminder about the first cycle's already-fixed issue,
    // even though this cycle's active revision request is about something else entirely.
    provider.script("plan_critic", [
      { response: { kind: "value", value: failingCritique } },
      { response: { kind: "value", value: secondFailingCritique } }
    ]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(2);

    const resolvedIssues = await prisma.planResolvedIssue.findMany({
      where: { planId, responsibleStage: "art_director" },
      orderBy: { createdAt: "asc" }
    });
    expect(resolvedIssues).toHaveLength(2);
    expect(resolvedIssues[0]?.problem).toBe("Motion durations are unmeasured.");
    expect(resolvedIssues[1]?.problem).toBe("Colour contrast is unmeasured.");

    // The second cycle's art_director patch call is the last one scripted against either
    // schema name - whichever it is, its prompt must carry cycle 1's issue as history, not
    // as the active fix (that's "Colour contrast is unmeasured" this time).
    const artDirectorCalls = provider.calls.filter(
      (call) => call.schemaName === "art_director" || call.schemaName === "art_director_patch"
    );
    const secondCycleCall = artDirectorCalls[artDirectorCalls.length - 1];
    expect(secondCycleCall?.prompt).toContain("PREVIOUSLY FIXED");
    expect(secondCycleCall?.prompt).toContain("Motion durations are unmeasured.");
  });

  it("fails with QUALITY_THRESHOLD_NOT_REACHED once the revision limit is exhausted", async () => {
    const provider = new FakeLlmProvider();
    provider.setDefault("plan_critic", { kind: "value", value: failingCritique });
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest({ maxRevisionCycles: 1 }));

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("failed");
    expect(plan.failureCode).toBe("QUALITY_THRESHOLD_NOT_REACHED");
    expect(plan.revisionCycle).toBe(1);

    const critiques = await prisma.critique.findMany({ where: { planId } });
    expect(critiques.length).toBeGreaterThanOrEqual(2);
    expect(critiques.every((c) => !c.passed)).toBe(true);

    const manifestArtifact = await prisma.planArtifact.findFirst({ where: { planId, artifactType: "manifest_json" } });
    expect(manifestArtifact).not.toBeNull();
  });

  it("stops without completing when cancelled mid-run", async () => {
    const planIdRef = { current: "" };
    const provider = new FakeLlmProvider();
    provider.script("concept_generator", [
      {
        response: { kind: "valid" },
        sideEffect: async () => {
          await prisma.plan.update({ where: { id: planIdRef.current }, data: { status: "cancelled" } });
        }
      }
    ]);
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());
    planIdRef.current = planId;

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("cancelled");

    const intentRows = await stageRows(planId, "intent_interpreter");
    expect(intentRows).toHaveLength(1);
    const conceptRows = await stageRows(planId, "concept_generator");
    expect(conceptRows).toHaveLength(1);
    const creativeRows = await stageRows(planId, "creative_director");
    expect(creativeRows).toHaveLength(0);
  });

  it("stops without completing when paused mid-run, then continues on resume without redoing completed stages", async () => {
    const planIdRef = { current: "" };
    const provider = new FakeLlmProvider();
    provider.script("concept_generator", [
      {
        response: { kind: "valid" },
        sideEffect: async () => {
          await prisma.plan.update({ where: { id: planIdRef.current }, data: { status: "paused" } });
        }
      }
    ]);
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());
    planIdRef.current = planId;

    await orchestrator.runPlan(planId);

    const paused = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(paused.status).toBe("paused");

    const intentRows = await stageRows(planId, "intent_interpreter");
    expect(intentRows).toHaveLength(1);
    const conceptRows = await stageRows(planId, "concept_generator");
    expect(conceptRows).toHaveLength(1);
    const creativeRows = await stageRows(planId, "creative_director");
    expect(creativeRows).toHaveLength(0);

    // Resuming just flips the status back and re-invokes runPlan, exactly like retrying
    // after a failure - already-completed stages are untouched, only the rest run.
    await prisma.plan.update({ where: { id: planId }, data: { status: "queued" } });
    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");

    for (const stage of ["intent_interpreter", "concept_generator"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.attempt).toBe(1);
    }
  });

  it("aborts an in-flight stage once paused longer than the grace period, without downgrading the plan to failed", async () => {
    const originalGraceMs = process.env.PLANNER_PAUSE_GRACE_MS;
    // Small enough that the orchestrator's pause-poll (which scales its interval down with
    // a short grace period - see runStage) fires well before this test's own timeout.
    process.env.PLANNER_PAUSE_GRACE_MS = "150";
    try {
      const planIdRef = { current: "" };
      const provider = new FakeLlmProvider();
      provider.script("concept_generator", [
        {
          response: { kind: "valid" },
          // Long enough that the request would still be in flight when the grace period
          // elapses and the orchestrator force-aborts it - proves the abort actually cuts
          // the call short rather than just waiting it out.
          delayMs: 10_000,
          sideEffect: async () => {
            await prisma.plan.update({ where: { id: planIdRef.current }, data: { status: "paused" } });
          }
        }
      ]);
      const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
      const { planId } = await orchestrator.createPlan(baseRequest());
      planIdRef.current = planId;

      await expect(orchestrator.runPlan(planId)).rejects.toThrow(/paused for longer than the grace period/);

      const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
      // Still "paused", not "failed" - a grace-timeout abort isn't a real failure needing
      // /retry, the plan is already exactly where /pause left it and /resume is correct.
      expect(plan.status).toBe("paused");
      expect(plan.failureCode).toBeNull();

      const conceptRows = await stageRows(planId, "concept_generator");
      expect(conceptRows).toHaveLength(1);
      expect(conceptRows[0]?.status).toBe("failed");

      // Resuming retries the aborted stage in full (it never produced output) and continues.
      await prisma.plan.update({ where: { id: planId }, data: { status: "queued" } });
      await orchestrator.runPlan(planId);

      const resumed = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
      expect(resumed.status).toBe("passed");

      const conceptRowsAfterResume = await stageRows(planId, "concept_generator");
      expect(conceptRowsAfterResume).toHaveLength(2);
      expect(conceptRowsAfterResume[1]?.status).toBe("completed");
    } finally {
      if (originalGraceMs === undefined) delete process.env.PLANNER_PAUSE_GRACE_MS;
      else process.env.PLANNER_PAUSE_GRACE_MS = originalGraceMs;
    }
  });

  it("addInstruction actually causes the target stage (and its dependents) to regenerate, not just recorded as inert", async () => {
    const provider = new FakeLlmProvider();
    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());
    await orchestrator.runPlan(planId);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).status).toBe("passed");

    await orchestrator.addInstruction(planId, "Break the WS-SIM/WS-SAVE cycle.", "systems_architect");

    const afterInstruction = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(afterInstruction.status).toBe("awaiting_revision");

    // Only systems_architect and what actually depends on it (per STAGE_CONTEXT_DEPENDENCIES)
    // should be marked superseded - everything upstream of it must be left alone.
    for (const stage of ["systems_architect", "edge_case_hunter", "scope_challenger", "specification_compiler", "plan_critic", "plan_gate"]) {
      const rows = await stageRows(planId, stage);
      expect(rows[0]?.status).toBe("superseded");
    }
    for (const stage of ["intent_interpreter", "concept_generator", "creative_director", "feature_expander", "ux_designer", "art_director"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("completed");
    }

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");

    const systemsArchitectRows = await stageRows(planId, "systems_architect");
    expect(systemsArchitectRows).toHaveLength(2);
    expect(systemsArchitectRows[1]?.status).toBe("completed");
    for (const stage of ["intent_interpreter", "concept_generator", "creative_director", "feature_expander", "ux_designer", "art_director"]) {
      const rows = await stageRows(planId, stage);
      expect(rows).toHaveLength(1);
    }
  });

  it("auto-repairs a dangling feature dependency without spending a revision cycle", async () => {
    const provider = new FakeLlmProvider();
    const brokenFeatureExpansion = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    brokenFeatureExpansion.features[0]!.dependencies = ["F999"];
    // setDefault (not script): every re-run would still produce the dangling reference, so
    // reaching "passed" on the first pass proves the manifest was auto-repaired in place
    // rather than fixed by feature_expander regenerating cleanly on a revision.
    provider.setDefault("feature_expander", { kind: "value", value: brokenFeatureExpansion });

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(0);

    const evaluations = await prisma.planGateEvaluation.findMany({ where: { planId }, orderBy: { createdAt: "asc" } });
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.decision).toBe("passed");

    const featureExpanderRows = await stageRows(planId, "feature_expander");
    expect(featureExpanderRows).toHaveLength(1);
    expect(featureExpanderRows[0]?.status).toBe("completed");
  });

  it("catches a circular feature dependency immediately after feature_expander, instead of waiting for the end-of-pipeline plan_gate cascade", async () => {
    const provider = new FakeLlmProvider();
    const brokenFeatureExpansion = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    brokenFeatureExpansion.features[0]!.dependencies = [brokenFeatureExpansion.features[0]!.id];
    provider.script("feature_expander", [{ response: { kind: "value", value: brokenFeatureExpansion } }]);
    // Not auto-repairable (a real cycle, not a dangling id) and its responsibleStage is
    // feature_expander itself, so runStageWithEarlyGateChecks retries feature_expander
    // in place - via patch mode (see registry.ts), same as a normal revision - before the
    // plan ever reaches plan_critic/plan_gate. An unscripted patch defaults to a no-op (see
    // fake-llm-provider.ts), which would leave the cycle intact and never recover.
    provider.script("feature_expander_patch", [
      { response: { kind: "value", value: { features: [{ ...brokenFeatureExpansion.features[0], dependencies: [] }] } } }
    ]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    // The cycle never reaches plan_gate at all, so no revision cycle is spent fixing it -
    // this is the whole point: caught and fixed at the stage that introduced it.
    expect(plan.revisionCycle).toBe(0);

    const evaluations = await prisma.planGateEvaluation.findMany({ where: { planId }, orderBy: { createdAt: "asc" } });
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.decision).toBe("passed");

    const featureExpanderRows = await stageRows(planId, "feature_expander");
    expect(featureExpanderRows).toHaveLength(2);
    expect(featureExpanderRows[0]?.status).toBe("superseded");
    expect(featureExpanderRows[1]?.status).toBe("completed");
  });

  it("reaches passed status on the first pass with warnings attached when plan_gate finds only a warning", async () => {
    const provider = new FakeLlmProvider();
    const synthesisWithUnknownLabel = cloneFixture(VALID_STAGE_OUTPUTS.specification_compiler as CompilerSynthesis);
    synthesisWithUnknownLabel.implementationPlan.dependencyGraph = [
      { from: "Unknown Module", to: "Search Service", reason: "test" }
    ];
    provider.script("specification_compiler", [{ response: { kind: "value", value: synthesisWithUnknownLabel } }]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.revisionCycle).toBe(0);

    const evaluation = await prisma.planGateEvaluation.findFirstOrThrow({ where: { planId } });
    expect(evaluation.decision).toBe("passed_with_warnings");
    expect(evaluation.warningCount).toBeGreaterThanOrEqual(1);
  });

  function scriptAmbiguousDependency(provider: FakeLlmProvider): void {
    const featureExpansion = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    const second = cloneFixture(featureExpansion.features[0]!);
    second.id = "F002";
    second.name = "Shape-similarity search";
    featureExpansion.features.push(second);
    featureExpansion.features[0]!.dependencies = ["F002"];
    provider.setDefault("feature_expander", { kind: "value", value: featureExpansion });

    const scopePlan = cloneFixture(VALID_STAGE_OUTPUTS.scope_challenger as ScopePlan);
    scopePlan.classifications.push({
      itemId: "F002",
      itemName: "Shape-similarity search",
      scopeClass: "experimental",
      rationale: "Too costly for the first release.",
      cheaperAlternative: null,
      isSignatureElement: false
    });
    provider.setDefault("scope_challenger", { kind: "value", value: scopePlan });
  }

  it("invokes the adjudicator and keeps a confirmed ambiguous warning active", async () => {
    const provider = new FakeLlmProvider();
    scriptAmbiguousDependency(provider);
    provider.script("plan_gate_adjudication", [
      {
        response: {
          kind: "value",
          value: {
            adjudications: [
              {
                findingId: "dep-essential-depends-on-deferred:F001:F002",
                outcome: "confirmed",
                rationale: "The dependency is real; F001 cannot ship without it."
              }
            ]
          }
        }
      }
    ]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");

    const evaluation = await prisma.planGateEvaluation.findFirstOrThrow({ where: { planId } });
    expect(evaluation.decision).toBe("passed_with_warnings");
    const output = evaluation.outputJson as { adjudicationUsed: boolean };
    expect(output.adjudicationUsed).toBe(true);
  });

  it("invokes the adjudicator and dismisses an ambiguous warning, allowing a clean pass", async () => {
    const provider = new FakeLlmProvider();
    scriptAmbiguousDependency(provider);
    provider.script("plan_gate_adjudication", [
      {
        response: {
          kind: "value",
          value: {
            adjudications: [
              {
                findingId: "dep-essential-depends-on-deferred:F001:F002",
                outcome: "dismissed",
                rationale: "F002 is an optional enhancement, not a hard dependency."
              }
            ]
          }
        }
      }
    ]);

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");

    const evaluation = await prisma.planGateEvaluation.findFirstOrThrow({ where: { planId } });
    expect(evaluation.decision).toBe("passed");
    const output = evaluation.outputJson as { adjudicationUsed: boolean };
    expect(output.adjudicationUsed).toBe(true);
  });

  it("fails with PLAN_GATE_REJECTED once the revision limit is exhausted", async () => {
    const provider = new FakeLlmProvider();
    const brokenFeatureExpansion = cloneFixture(VALID_STAGE_OUTPUTS.feature_expander as FeatureExpansion);
    // A self-referencing dependency is a genuine cycle (not auto-repairable - only exact,
    // provably-dangling references get stripped), so this keeps testing the true
    // revision-exhaustion path rather than something the auto-repair pass would now fix.
    brokenFeatureExpansion.features[0]!.dependencies = [brokenFeatureExpansion.features[0]!.id];
    provider.setDefault("feature_expander", { kind: "value", value: brokenFeatureExpansion });

    const orchestrator = new PlannerOrchestrator({ prisma, logger: silentLogger, provider });
    const { planId } = await orchestrator.createPlan(baseRequest({ maxRevisionCycles: 1 }));

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("failed");
    expect(plan.failureCode).toBe("PLAN_GATE_REJECTED");
    expect(plan.revisionCycle).toBe(1);

    const evaluations = await prisma.planGateEvaluation.findMany({ where: { planId } });
    expect(evaluations.length).toBeGreaterThanOrEqual(2);
    expect(evaluations.every((evaluation) => evaluation.decision === "rejected")).toBe(true);
  });

  it("does not attempt to publish a plan created without an implementationTarget", async () => {
    const publishClient = vi.fn();
    const orchestrator = new PlannerOrchestrator({
      prisma,
      logger: silentLogger,
      provider: new FakeLlmProvider(),
      implementationOrchestratorClient: publishClient
    });
    const { planId } = await orchestrator.createPlan(baseRequest());

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.implementationPublishStatus).toBeNull();
    expect(publishClient).not.toHaveBeenCalled();
  });

  it("publishes a passed plan and records the workflowId when an implementationTarget is set", async () => {
    const publishClient = vi.fn().mockResolvedValue({ workflowId: "wf-abc123" });
    const orchestrator = new PlannerOrchestrator({
      prisma,
      logger: silentLogger,
      provider: new FakeLlmProvider(),
      implementationOrchestratorClient: publishClient
    });
    const { planId } = await orchestrator.createPlan({
      ...baseRequest(),
      implementationTarget: {
        repository: { url: "git@github.com:example/project.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "mock"
      }
    });

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.implementationPublishStatus).toBe("published");
    expect(plan.implementationWorkflowId).toBe("wf-abc123");
    expect(plan.implementationPublishError).toBeNull();
    expect(publishClient).toHaveBeenCalledTimes(1);
    const call = publishClient.mock.calls[0]![0];
    expect(call.planId).toBe(planId);
    expect(call.target.builderProfile).toBe("mock");
  });

  it("records a failed publish status without downgrading Plan.status when the publish call fails", async () => {
    const publishClient = vi.fn().mockRejectedValue(new Error("connection refused"));
    const orchestrator = new PlannerOrchestrator({
      prisma,
      logger: silentLogger,
      provider: new FakeLlmProvider(),
      implementationOrchestratorClient: publishClient
    });
    const { planId } = await orchestrator.createPlan({
      ...baseRequest(),
      implementationTarget: {
        repository: { url: "git@github.com:example/project.git", baseBranch: "main" },
        policyProfile: "default-safe",
        builderProfile: "mock"
      }
    });

    await orchestrator.runPlan(planId);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("passed");
    expect(plan.implementationPublishStatus).toBe("failed");
    expect(plan.implementationPublishError).toContain("connection refused");
    expect(plan.implementationWorkflowId).toBeNull();
  });
});
