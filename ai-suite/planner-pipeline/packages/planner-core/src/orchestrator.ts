import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@planner/database";
import {
  PLANNER_STAGE_NAMES,
  createPlanRequestSchema,
  implementationTargetSchema,
  plannerStageNameSchema,
  planPreferencesSchema,
  projectDefinitionSchema,
  type BuildManifest,
  type CreatePlanRequest,
  type PlanCritique,
  type PlanGateFinding,
  type PlanGateResult,
  type PlannerStageName,
  type RevisionRequest,
  type StageOutputByName
} from "@planner/contracts";
import {
  createProvider,
  createTokenBudget,
  defaultModelProfile,
  ensureModelLoaded,
  modelKeyForStage,
  StructuredGenerationError,
  type LlmProvider,
  type ProviderHealth,
  type StructuredGenerationRequest,
  type StructuredGenerationResponse,
  type TextGenerationRequest,
  type TextGenerationResponse
} from "@planner/llm";
import {
  recordImplementationPublish,
  recordJobCompleted,
  recordJobFailed,
  recordJobQueued,
  recordLlmRequest,
  recordLlmTokens,
  recordPlanGateDecision,
  recordPlanGateFinding,
  recordQualityScore,
  recordRevisionCycles,
  recordStageDuration,
  recordStageFailure
} from "@planner/observability";
import pino from "pino";
import { ZodError } from "zod";
import { createStageRegistry, STAGE_ORDER } from "./registry.js";
import { compileBuildManifest, manifestToMarkdown, manifestToYaml } from "./output-compiler.js";
import { publishToImplementationOrchestrator } from "./publish/implementation-orchestrator-client.js";
import { evaluateQualityGate } from "./quality-gate.js";
import { computeDirtyStages, routePlanGateRevisions, routeRevisions } from "./revision-router.js";
import { attemptAutoRepair } from "./plan-gate/auto-repair.js";
import { evaluateEarlyPlanGateChecks, findingsEligibleForImmediateRetry } from "./plan-gate/early-checks.js";
import { evaluatePlanGate } from "./plan-gate/evaluate.js";
import { buildPartialManifest } from "./plan-gate/partial-manifest.js";
import { buildPlanGateResult } from "./plan-gate/result-builder.js";
import type { PlannerLogger } from "./stage.js";

/**
 * Thrown to abort an in-flight LLM call after a plan has been continuously "paused" for
 * PLANNER_PAUSE_GRACE_MS - pause only stops the *next* stage from starting (see runPlan's
 * between-stage check), so without this a paused plan could still be waiting on the current
 * stage for however long PLANNER_STAGE_TIMEOUT_MS allows (tens of minutes).
 */
export class PauseGraceTimeoutError extends Error {
  constructor(stageName: string) {
    super(`${stageName}: paused for longer than the grace period, aborting the in-flight call.`);
    this.name = "PauseGraceTimeoutError";
  }
}

const DEFAULT_STAGE_SCHEMA_ATTEMPTS = 2;

export interface OrchestratorOptions {
  prisma: PrismaClient;
  logger?: PlannerLogger;
  /** Overrides the env-configured provider. Primarily used to inject a deterministic fake in tests. */
  provider?: LlmProvider;
  /** Overrides the default HTTP client used to publish a passed plan. Primarily used to inject a deterministic fake in tests. */
  implementationOrchestratorClient?: typeof publishToImplementationOrchestrator;
}

export class PlannerOrchestrator {
  private readonly logger: PlannerLogger;
  private readonly stages = createStageRegistry();

  constructor(private readonly options: OrchestratorOptions) {
    this.logger = options.logger ?? pino({ level: process.env.LOG_LEVEL ?? "info" });
  }

  async createPlan(request: CreatePlanRequest): Promise<{ planId: string; status: "queued" }> {
    const parsed = createPlanRequestSchema.parse(request);
    const planId = `plan_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await this.options.prisma.plan.create({
      data: {
        id: planId,
        title: parsed.title,
        brief: parsed.brief,
        constraintsJson: parsed.constraints,
        preferencesJson: parsed.preferences,
        contextJson: parsed.context,
        implementationTargetJson: parsed.implementationTarget,
        maxRevisionCycles: parsed.preferences.maxRevisionCycles,
        status: "queued"
      }
    });
    recordJobQueued();
    return { planId, status: "queued" };
  }

  /**
   * Records a human-provided instruction and marks rerunFromStage - plus everything that
   * transitively depends on it, per the same STAGE_CONTEXT_DEPENDENCIES cascade normal
   * revisions use - as superseded, so the next runPlan() call actually regenerates it.
   * Without this, the instruction would just sit in the DB as an inert RevisionRequest
   * (see loadPendingRevisionRequests): every stage would still read back as "completed" and
   * the main loop would skip straight past all of them, so nothing would ever act on it.
   */
  async addInstruction(planId: string, instruction: string, rerunFromStage: PlannerStageName): Promise<void> {
    await this.options.prisma.planInstruction.create({
      data: { planId, instruction, rerunFromStage }
    });
    const stagesToRerun = computeDirtyStages([rerunFromStage]);
    await this.supersedeStages(planId, stagesToRerun);
    await this.options.prisma.plan.update({
      where: { id: planId },
      data: { status: "awaiting_revision", currentStage: stagesToRerun[0] ?? rerunFromStage }
    });
  }

  async runPlan(planId: string, abortSignal = new AbortController().signal): Promise<void> {
    const plan = await this.options.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error(`Plan ${planId} not found.`);
    if (plan.status === "cancelled" || plan.status === "paused") return;

    await this.options.prisma.plan.update({
      where: { id: planId },
      data: { status: "running", failureCode: null, failureMessage: null }
    });

    const provider = this.options.provider ?? createProvider();
    // Which stages actually need a fresh attempt is derived purely from each stage's own
    // latest status (see loadLatestOutputs/loadLatestStageOutput) rather than a single
    // start-index slice - this is what lets a revision cycle regenerate a non-contiguous
    // set of dirty stages (see revision-router.ts) while everything else, already
    // "completed" and untouched by supersedeStages, is correctly left alone. It also
    // naturally covers worker-restart resume: whatever's already "completed" is skipped.
    let revisionRequests: RevisionRequest[] = await this.loadPendingRevisionRequests(planId);

    while (true) {
      const freshPlan = await this.options.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
      const project = this.projectFromPlan(freshPlan);
      const outputs = await this.loadLatestOutputs(planId);

      for (const stageName of STAGE_ORDER) {
        if (outputs[stageName] !== undefined) continue;
        const latestPlan = await this.options.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
        // Checked between stages, not preemptively: a pause never aborts a stage that's
        // already generating - it just stops the next one from starting. Whatever stage is
        // in flight when pause is requested runs to its normal completion or failure.
        if (latestPlan.status === "cancelled" || latestPlan.status === "paused") return;
        await this.runStageWithEarlyGateChecks({
          planId,
          stageName,
          project,
          outputs,
          revisionRequests,
          abortSignal,
          provider
        });
      }

      const critique = outputs.plan_critic as PlanCritique | undefined;
      let manifest = outputs.final_manifest as BuildManifest | undefined;
      let planGateResult = outputs.plan_gate as PlanGateResult | undefined;
      if (!critique || !manifest) throw new Error("Plan did not produce critique and manifest.");

      if (planGateResult?.decision === "rejected") {
        const repairAttempt = attemptAutoRepair(manifest, planGateResult.findings);
        if (repairAttempt.repairedFindingIds.length > 0) {
          const { findings: repairedFindings, coverage: repairedCoverage } = evaluatePlanGate(
            repairAttempt.manifest,
            critique
          );
          const repairedResult = buildPlanGateResult(repairedFindings, repairedCoverage, planGateResult.adjudicationUsed);
          this.logger.info(
            {
              planId,
              repairedFindingIds: repairAttempt.repairedFindingIds,
              previousDecision: planGateResult.decision,
              newDecision: repairedResult.decision
            },
            "plan_gate auto-repair applied"
          );
          manifest = repairAttempt.manifest;
          planGateResult = repairedResult;
          outputs.final_manifest = manifest as never;
          outputs.plan_gate = planGateResult as never;
          await this.persistManifestArtifacts(planId, manifest);
        }
      }

      const preferences = planPreferencesSchema.parse(freshPlan.preferencesJson);
      const gate = evaluateQualityGate(critique, manifest, preferences);
      await this.options.prisma.critique.create({
        data: {
          planId,
          revisionCycle: freshPlan.revisionCycle,
          overallScore: critique.overallScore,
          categoryScoresJson: critique.categoryScores,
          passed: gate.passed,
          outputJson: critique
        }
      });

      recordQualityScore(planId, critique.overallScore);

      if (planGateResult) {
        await this.options.prisma.planGateEvaluation.create({
          data: {
            planId,
            revisionCycle: freshPlan.revisionCycle,
            decision: planGateResult.decision,
            errorCount: planGateResult.errorCount,
            warningCount: planGateResult.warningCount,
            noticeCount: planGateResult.noticeCount,
            outputJson: planGateResult
          }
        });
        recordPlanGateDecision(planGateResult.decision);
        for (const finding of planGateResult.findings) recordPlanGateFinding(finding.ruleId, finding.severity);
      }

      // Both gates are evaluated together rather than short-circuiting on the critique: the
      // previous structure only ever consulted whichever gate happened to be checked first,
      // so whenever both failed in the same cycle (the common case once plan sizes grew), the
      // gate that was checked second had its findings silently dropped from the next cycle's
      // revision requests - which is why the same plan_gate reference errors kept recurring
      // cycle after cycle even though the critic's separate issues were being addressed.
      const planGatePassed = !planGateResult || planGateResult.decision !== "rejected";

      if (gate.passed && planGatePassed) {
        await this.options.prisma.plan.update({
          where: { id: planId },
          data: {
            status: "passed",
            currentStage: null,
            qualityScore: critique.overallScore,
            completedAt: new Date()
          }
        });
        recordJobCompleted();
        recordRevisionCycles(freshPlan.revisionCycle);
        await this.publishPlan(planId);
        return;
      }

      const gateErrorFindings = planGateResult
        ? planGateResult.findings.filter(
            (finding) => finding.severity === "error" && finding.adjudicationOutcome !== "dismissed"
          )
        : [];

      if (freshPlan.revisionCycle >= freshPlan.maxRevisionCycles) {
        const failureCode =
          !gate.passed && !planGatePassed
            ? "QUALITY_AND_GATE_NOT_REACHED"
            : !planGatePassed
              ? "PLAN_GATE_REJECTED"
              : "QUALITY_THRESHOLD_NOT_REACHED";
        const failureMessage = [
          !gate.passed ? gate.reasons.join(" ") : null,
          !planGatePassed ? gateErrorFindings.map((finding) => finding.problem).join(" ") : null
        ]
          .filter((part): part is string => Boolean(part))
          .join(" | ");
        await this.options.prisma.plan.update({
          where: { id: planId },
          data: {
            status: "failed",
            currentStage: null,
            qualityScore: critique.overallScore,
            completedAt: new Date(),
            failureCode,
            failureMessage
          }
        });
        recordJobFailed(failureCode);
        recordRevisionCycles(freshPlan.revisionCycle);
        return;
      }

      const critiqueRoute = !gate.passed ? routeRevisions(critique) : null;
      const gateRoute = !planGatePassed ? routePlanGateRevisions(gateErrorFindings) : null;
      const combinedRoutes = [critiqueRoute, gateRoute].filter(
        (route): route is NonNullable<typeof route> => route !== null
      );
      const earliestStage = combinedRoutes.reduce<PlannerStageName>(
        (earliest, route) =>
          STAGE_ORDER.indexOf(route.earliestStage) < STAGE_ORDER.indexOf(earliest) ? route.earliestStage : earliest,
        combinedRoutes[0]?.earliestStage ?? "specification_compiler"
      );
      const dirtyStageSet = new Set(combinedRoutes.flatMap((route) => route.stagesToRerun));
      const stagesToRerun = STAGE_ORDER.filter((stage) => dirtyStageSet.has(stage));

      revisionRequests = combinedRoutes.flatMap((route) => route.requests);
      await this.recordResolvedIssues(planId, freshPlan.revisionCycle + 1, revisionRequests);
      await this.supersedeStages(planId, stagesToRerun);
      await this.options.prisma.plan.update({
        where: { id: planId },
        data: {
          status: "awaiting_revision",
          revisionCycle: { increment: 1 },
          currentStage: earliestStage,
          qualityScore: critique.overallScore
        }
      });
    }
  }

  /**
   * Persists every revision request raised this cycle to a durable, append-only ledger -
   * regardless of whether the request is a minor one that won't force a regeneration on its
   * own. Patch mode already guarantees a stage's *untouched* fields survive a revision
   * byte-for-byte, but does nothing for a field that gets touched again later for an
   * unrelated reason (a downstream cascade, a different critique finding on the same stage).
   * Future prompts for the same responsibleStage (see loadResolvedIssues) are reminded of
   * every issue ever raised against it, so a regeneration doesn't silently reintroduce
   * something already fixed just because the model wasn't told it mattered.
   */
  private async recordResolvedIssues(
    planId: string,
    revisionCycle: number,
    requests: RevisionRequest[]
  ): Promise<void> {
    if (requests.length === 0) return;
    await this.options.prisma.planResolvedIssue.createMany({
      data: requests.map((request) => ({
        planId,
        section: request.section,
        problem: request.problem,
        requiredChange: request.requiredChange,
        responsibleStage: request.responsibleStage,
        revisionCycle
      }))
    });
  }

  /**
   * The full history of issues ever raised against this specific stage, oldest first -
   * rendered by buildStagePrompt as a "previously fixed, don't reintroduce" reminder.
   * Deliberately not deduplicated: if the same issue was flagged multiple cycles, that's
   * itself useful signal that it's a recurring, hard-to-keep-fixed spot for the model to be
   * extra careful about.
   */
  private async loadResolvedIssues(planId: string, stageName: PlannerStageName): Promise<RevisionRequest[]> {
    const rows = await this.options.prisma.planResolvedIssue.findMany({
      where: { planId, responsibleStage: stageName },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({
      section: row.section,
      problem: row.problem,
      requiredChange: row.requiredChange,
      responsibleStage: stageName,
      severity: "major" as const
    }));
  }

  /**
   * Publishes a passed plan's manifest + plan gate result to the implementation orchestrator.
   * No-op if the plan has no implementationTarget (planning-only plan). Never throws — a plan
   * that legitimately passed stays "passed" even if the downstream publish fails; the outcome
   * is recorded on the plan row for a human (or POST /v1/plans/:planId/publish) to retry.
   * Reloads everything fresh from the DB by planId so this same method also serves manual retries.
   */
  async publishPlan(planId: string): Promise<void> {
    try {
      const plan = await this.options.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
      if (!plan.implementationTargetJson) return;
      const target = implementationTargetSchema.parse(plan.implementationTargetJson);

      const manifestArtifact = await this.options.prisma.planArtifact.findFirst({
        where: { planId, artifactType: "manifest_json" },
        orderBy: { version: "desc" }
      });
      const gateEvaluation = await this.options.prisma.planGateEvaluation.findFirst({
        where: { planId },
        orderBy: { createdAt: "desc" }
      });
      if (!manifestArtifact || !gateEvaluation) return;

      await this.options.prisma.plan.update({
        where: { id: planId },
        data: { implementationPublishStatus: "pending" }
      });

      const publish = this.options.implementationOrchestratorClient ?? publishToImplementationOrchestrator;
      try {
        const result = await publish({
          title: plan.title,
          manifest: JSON.parse(manifestArtifact.content) as BuildManifest,
          planGate: gateEvaluation.outputJson as PlanGateResult,
          planId,
          target
        });
        await this.options.prisma.plan.update({
          where: { id: planId },
          data: {
            implementationWorkflowId: result.workflowId,
            implementationPublishStatus: "published",
            implementationPublishedAt: new Date(),
            implementationPublishError: null
          }
        });
        recordImplementationPublish("published");
      } catch (error) {
        await this.options.prisma.plan.update({
          where: { id: planId },
          data: {
            implementationPublishStatus: "failed",
            implementationPublishError: error instanceof Error ? error.message : String(error)
          }
        });
        recordImplementationPublish("failed");
        this.logger.error({ planId, err: error }, "Failed to publish plan to implementation-orchestrator.");
      }
    } catch (error) {
      this.logger.error({ planId, err: error }, "Unexpected error while attempting to publish plan.");
    }
  }

  private async runStage(args: {
    planId: string;
    stageName: PlannerStageName;
    plan: unknown;
    previousOutputs: Record<string, unknown>;
    revisionRequests: RevisionRequest[];
    previousStageOutput: unknown;
    abortSignal: AbortSignal;
    provider: LlmProvider;
  }): Promise<void> {
    const stage = this.stages.get(args.stageName);
    if (!stage) throw new Error(`Stage ${args.stageName} is not registered.`);
    const attempt = (await this.options.prisma.stageExecution.count({
      where: { planId: args.planId, stageName: args.stageName }
    })) + 1;
    const resolvedIssues = await this.loadResolvedIssues(args.planId, args.stageName);
    const input = await stage.buildInput({
      plan: args.plan,
      previousOutputs: args.previousOutputs as Partial<StageOutputByName>,
      revisionRequests: args.revisionRequests,
      previousStageOutput: args.previousStageOutput,
      resolvedIssues
    });
    const execution = await this.options.prisma.stageExecution.create({
      data: {
        planId: args.planId,
        stageName: args.stageName,
        stageVersion: stage.version,
        status: "running",
        attempt,
        inputJson: input as never,
        modelProfile: defaultModelProfile(args.stageName).id
      }
    });
    await this.options.prisma.plan.update({
      where: { id: args.planId },
      data: { status: "running", currentStage: args.stageName }
    });
    const started = Date.now();
    const recordingProvider = new RecordingProvider(args.provider, args.stageName);
    const storeRawOutput = process.env.STORE_RAW_LLM_OUTPUT !== "false";

    const pauseGraceMs = Number(process.env.PLANNER_PAUSE_GRACE_MS ?? 600_000);
    // Scales down with a short grace period (e.g. in tests) rather than always polling every
    // 5s, which would make a small PLANNER_PAUSE_GRACE_MS pointless - capped at 5s so the
    // production default (10 minutes) doesn't poll needlessly often.
    const pausePollIntervalMs = Math.min(5_000, Math.max(50, Math.floor(pauseGraceMs / 10)));
    const stageAbortController = new AbortController();
    args.abortSignal.addEventListener("abort", () => stageAbortController.abort(args.abortSignal.reason), {
      once: true
    });
    let pausedSince: number | null = null;
    const pausePoll = setInterval(() => {
      if (stageAbortController.signal.aborted) return;
      void this.options.prisma.plan
        .findUnique({ where: { id: args.planId }, select: { status: true } })
        .then((latest) => {
          if (latest?.status !== "paused") {
            pausedSince = null;
            return;
          }
          pausedSince ??= Date.now();
          if (Date.now() - pausedSince >= pauseGraceMs) {
            stageAbortController.abort(new PauseGraceTimeoutError(args.stageName));
          }
        })
        .catch(() => {});
    }, pausePollIntervalMs);

    try {
      // No-op unless LLM_MANAGEMENT_BASE_URL is configured for per-stage model routing (see
      // model-switcher.ts) - stages run strictly sequentially, so swapping the server's one
      // loaded model between stage groups is safe.
      await ensureModelLoaded(modelKeyForStage(args.stageName));
      const output = stage.validate(
        await stage.execute(input, {
          planId: args.planId,
          attempt,
          model: recordingProvider,
          abortSignal: stageAbortController.signal,
          logger: this.logger.child({ planId: args.planId, stage: args.stageName, attempt }),
          tokenBudget: createTokenBudget(defaultModelProfile(args.stageName).maxOutputTokens)
        })
      );
      const summary = stage.summarize(output);
      const durationMs = Date.now() - started;
      recordStageDuration(args.stageName, durationMs);
      await this.options.prisma.stageExecution.update({
        where: { id: execution.id },
        data: {
          status: "completed",
          rawOutput: storeRawOutput ? recordingProvider.lastRawText : null,
          outputJson: output as never,
          summaryJson: summary as never,
          tokenUsageJson: recordingProvider.lastTokenUsage as never,
          durationMs,
          completedAt: new Date()
        }
      });
    } catch (error) {
      const pausedOut = stageAbortController.signal.reason instanceof PauseGraceTimeoutError;
      const status =
        error instanceof ZodError || error instanceof StructuredGenerationError ? "invalid_output" : "failed";
      const durationMs = Date.now() - started;
      recordStageDuration(args.stageName, durationMs);
      recordStageFailure(args.stageName, status);
      await this.options.prisma.stageExecution.update({
        where: { id: execution.id },
        data: {
          status,
          rawOutput: storeRawOutput ? recordingProvider.lastRawText : null,
          tokenUsageJson: recordingProvider.lastTokenUsage as never,
          errorJson: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          },
          durationMs,
          completedAt: new Date()
        }
      });
      // A pause-grace-timeout abort isn't a real failure needing /retry - the plan is already
      // "paused" (that's what triggered it), and it should stay that way so /resume is the
      // natural next step, rather than getting stomped to "failed" like a genuine error would.
      if (!pausedOut) {
        await this.options.prisma.plan.update({
          where: { id: args.planId },
          data: {
            status: "failed",
            failureCode: status === "invalid_output" ? "STAGE_INVALID_OUTPUT" : "STAGE_FAILED",
            failureMessage: `${args.stageName}: ${error instanceof Error ? error.message : String(error)}`
          }
        });
      }
      throw error;
    } finally {
      clearInterval(pausePoll);
    }
  }

  private async runStageWithSchemaRetries(args: {
    planId: string;
    stageName: PlannerStageName;
    plan: unknown;
    previousOutputs: Record<string, unknown>;
    revisionRequests: RevisionRequest[];
    previousStageOutput: unknown;
    abortSignal: AbortSignal;
    provider: LlmProvider;
  }): Promise<void> {
    const maxAttempts = Number(process.env.PLANNER_STAGE_SCHEMA_ATTEMPTS ?? DEFAULT_STAGE_SCHEMA_ATTEMPTS);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.runStage(args);
        return;
      } catch (error) {
        if (!this.shouldRetrySchemaFailure(error, attempt, maxAttempts)) throw error;
        const latestPlan = await this.options.prisma.plan.findUnique({
          where: { id: args.planId },
          select: { status: true }
        });
        if (latestPlan?.status === "cancelled" || latestPlan?.status === "paused") throw error;
        this.logger.warn(
          {
            planId: args.planId,
            stage: args.stageName,
            attempt,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error)
          },
          "Retrying stage after schema-invalid model output."
        );
      }
    }
  }

  private shouldRetrySchemaFailure(error: unknown, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false;
    if (error instanceof PauseGraceTimeoutError) return false;
    return error instanceof ZodError || error instanceof StructuredGenerationError;
  }

  /**
   * Runs a stage, then immediately checks it against whichever plan_gate rules just became
   * checkable (see PlanGateRule.earliestStage) instead of waiting for the full manifest and
   * plan_critic at the end of the pipeline. This is what catches things like a dangling
   * feature reference or a circular dependency at the stage that introduced them, rather than
   * 5+ stages later - which is when the previous design first noticed them, forcing a full
   * revision cycle back through everything in between (see [[project_ftl_babylonjs_pipeline_run]]
   * for the run whose repeated large-cascade oscillation motivated this).
   *
   * Only findings that (a) survive attemptAutoRepair - the same free, deterministic fix-up
   * plan_gate already applies at the end, so there's no point spending an LLM call on
   * something that gets silently repaired anyway - and (b) blame the stage that just ran
   * (rather than an earlier one the checkpoint merely depends on) trigger an immediate
   * same-stage retry, bounded by PLANNER_STAGE_GATE_RETRY_COUNT. Anything else is left for the
   * normal end-of-pipeline critique/plan_gate cascade, unchanged.
   */
  private async runStageWithEarlyGateChecks(args: {
    planId: string;
    stageName: PlannerStageName;
    project: unknown;
    outputs: Record<string, unknown>;
    revisionRequests: RevisionRequest[];
    abortSignal: AbortSignal;
    provider: LlmProvider;
  }): Promise<void> {
    const { planId, stageName, project, outputs, abortSignal, provider } = args;
    const maxGateAttempts = Number(process.env.PLANNER_STAGE_GATE_RETRY_COUNT ?? 2);

    for (let attempt = 1; attempt <= maxGateAttempts; attempt += 1) {
      const previousStageOutput = await this.loadPreviousStageOutput(planId, stageName);
      await this.runStageWithSchemaRetries({
        planId,
        stageName,
        plan: project,
        previousOutputs: outputs,
        revisionRequests: args.revisionRequests,
        previousStageOutput,
        abortSignal,
        provider
      });
      const stageOutput = await this.loadLatestStageOutput(planId, stageName);
      outputs[stageName] = stageOutput as never;
      if (stageName === "specification_compiler") {
        const manifest = compileBuildManifest(project as never, outputs);
        outputs.final_manifest = manifest;
        await this.persistManifestArtifacts(planId, manifest);
      }

      const manifestForCheck = (outputs.final_manifest as BuildManifest | undefined) ?? buildPartialManifest(project as never, outputs);
      const findings = evaluateEarlyPlanGateChecks(stageName, manifestForCheck);
      const retryable = findingsEligibleForImmediateRetry(findings, stageName);
      if (retryable.length === 0) return;

      if (attempt >= maxGateAttempts) {
        this.logger.warn(
          {
            planId,
            stage: stageName,
            findings: retryable.map((finding) => finding.problem)
          },
          "Stage still fails early plan_gate checks after max attempts; deferring to the end-of-pipeline critique/gate cascade."
        );
        return;
      }

      this.logger.warn(
        {
          planId,
          stage: stageName,
          attempt,
          findings: retryable.map((finding) => finding.problem)
        },
        "Stage failed early plan_gate checks; retrying the same stage immediately."
      );
      await this.supersedeStages(planId, [stageName]);
      args.revisionRequests = [...args.revisionRequests, ...this.gateFindingsToRevisionRequests(retryable)];
    }
  }

  private gateFindingsToRevisionRequests(findings: PlanGateFinding[]): RevisionRequest[] {
    return findings.map((finding) => ({
      section: finding.sectionPath,
      problem: finding.problem,
      requiredChange: finding.requiredChange,
      responsibleStage: finding.responsibleStage,
      severity: "blocking"
    }));
  }

  private async loadLatestOutputs(planId: string): Promise<Record<string, unknown>> {
    const outputs: Record<string, unknown> = {};
    for (const stageName of PLANNER_STAGE_NAMES) {
      const output = await this.loadLatestStageOutput(planId, stageName);
      if (output !== null) outputs[stageName] = output;
    }
    const artifact = await this.options.prisma.planArtifact.findFirst({
      where: { planId, artifactType: "manifest_json" },
      orderBy: { version: "desc" }
    });
    if (artifact) outputs.final_manifest = JSON.parse(artifact.content);
    return outputs;
  }

  private async loadLatestStageOutput(planId: string, stageName: PlannerStageName): Promise<unknown | null> {
    const execution = await this.options.prisma.stageExecution.findFirst({
      where: { planId, stageName, status: "completed" },
      orderBy: { completedAt: "desc" }
    });
    return execution?.outputJson ?? null;
  }

  /**
   * The last output this stage actually produced, whether or not it's since been
   * superseded by a revision - used as the patch base in registry.ts's LlmPlannerStage.
   * Unlike loadLatestStageOutput, this deliberately does NOT filter to status "completed":
   * by the time a dirty stage is about to be regenerated, its latest row has already been
   * flipped to "superseded", but that row's content is exactly what a patch should be based on.
   */
  private async loadPreviousStageOutput(planId: string, stageName: PlannerStageName): Promise<unknown> {
    const execution = await this.options.prisma.stageExecution.findFirst({
      where: { planId, stageName, status: { in: ["completed", "superseded"] } },
      orderBy: { attempt: "desc" }
    });
    return execution?.outputJson ?? undefined;
  }

  private async supersedeStages(planId: string, stageNames: PlannerStageName[]): Promise<void> {
    await this.options.prisma.stageExecution.updateMany({
      where: { planId, stageName: { in: stageNames }, status: "completed" },
      data: { status: "superseded" }
    });
  }

  private async persistManifestArtifacts(planId: string, manifest: BuildManifest): Promise<void> {
    const latest = await this.options.prisma.planArtifact.findFirst({
      where: { planId, artifactType: "manifest_json" },
      orderBy: { version: "desc" }
    });
    const version = (latest?.version ?? 0) + 1;
    await this.options.prisma.planArtifact.createMany({
      data: [
        {
          planId,
          artifactType: "manifest_json",
          format: "application/json",
          content: JSON.stringify(manifest, null, 2),
          version
        },
        {
          planId,
          artifactType: "manifest_yaml",
          format: "application/yaml",
          content: manifestToYaml(manifest),
          version
        },
        {
          planId,
          artifactType: "manifest_markdown",
          format: "text/markdown",
          content: manifestToMarkdown(manifest),
          version
        }
      ]
    });
  }

  private projectFromPlan(plan: {
    title: string;
    brief: string;
    constraintsJson: unknown;
    preferencesJson: unknown;
    contextJson: unknown;
  }) {
    return projectDefinitionSchema.parse({
      title: plan.title,
      brief: plan.brief,
      constraints: plan.constraintsJson,
      preferences: plan.preferencesJson,
      context: plan.contextJson
    });
  }

  /**
   * Combines the most recent (unpassed) critic revision requests with any human
   * direction, so a fresh runPlan() call resuming an in-progress revision still
   * has the original targeted patch instructions rather than an empty context.
   */
  private async loadPendingRevisionRequests(planId: string): Promise<RevisionRequest[]> {
    const latestCritique = await this.options.prisma.critique.findFirst({
      where: { planId },
      orderBy: { createdAt: "desc" }
    });
    let critiqueRequests: RevisionRequest[] = [];
    if (latestCritique && !latestCritique.passed) {
      critiqueRequests =
        (latestCritique.outputJson as { revisionRequests?: RevisionRequest[] }).revisionRequests ?? [];
    }
    const latestPlanGateEvaluation = await this.options.prisma.planGateEvaluation.findFirst({
      where: { planId },
      orderBy: { createdAt: "desc" }
    });
    let planGateRequests: RevisionRequest[] = [];
    if (latestPlanGateEvaluation && latestPlanGateEvaluation.decision === "rejected") {
      const result = latestPlanGateEvaluation.outputJson as PlanGateResult;
      const errorFindings = result.findings.filter(
        (finding) => finding.severity === "error" && finding.adjudicationOutcome !== "dismissed"
      );
      planGateRequests = routePlanGateRevisions(errorFindings).requests;
    }
    const instructions = await this.options.prisma.planInstruction.findMany({
      where: { planId },
      orderBy: { createdAt: "asc" }
    });
    const humanRequests: RevisionRequest[] = instructions.map((instruction, index) => ({
      section: "human_direction",
      problem: "A human provided additional direction after an earlier planning pass.",
      requiredChange: instruction.instruction,
      responsibleStage: plannerStageNameSchema.parse(instruction.rerunFromStage),
      severity: "major",
      id: `human-${index + 1}`
    }));
    return [...critiqueRequests, ...planGateRequests, ...humanRequests];
  }
}

class RecordingProvider implements LlmProvider {
  readonly id: string;
  lastRawText: string | null = null;
  lastTokenUsage: unknown = null;

  constructor(
    private readonly inner: LlmProvider,
    private readonly stageName: PlannerStageName
  ) {
    this.id = inner.id;
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    recordLlmRequest(this.inner.id, this.stageName);
    const response = await this.inner.generateText(request);
    this.lastRawText = response.text;
    this.lastTokenUsage = response.tokenUsage ?? null;
    recordLlmTokens(this.inner.id, this.stageName, response.tokenUsage);
    return response;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResponse<T>> {
    recordLlmRequest(this.inner.id, this.stageName);
    try {
      const response = await this.inner.generateStructured(request);
      this.lastRawText = response.rawText;
      this.lastTokenUsage = response.tokenUsage ?? null;
      recordLlmTokens(this.inner.id, this.stageName, response.tokenUsage);
      return response;
    } catch (error) {
      // Even on exhausted-repair failure, capture what the model actually produced -
      // otherwise the persisted StageExecution has a real validation error but a lost
      // (empty) rawOutput, making the failure much harder to diagnose after the fact.
      if (error instanceof StructuredGenerationError) {
        this.lastRawText = error.rawText;
        this.lastTokenUsage = error.tokenUsage ?? null;
      }
      throw error;
    }
  }

  healthCheck(): Promise<ProviderHealth> {
    return this.inner.healthCheck();
  }
}
