import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const metricsRegistry = new Registry();

const plannerJobsTotal = new Counter({
  name: "planner_jobs_total",
  help: "Total planning jobs created.",
  registers: [metricsRegistry]
});

const plannerJobsCompletedTotal = new Counter({
  name: "planner_jobs_completed_total",
  help: "Total planning jobs that passed the quality gate.",
  registers: [metricsRegistry]
});

const plannerJobsFailedTotal = new Counter({
  name: "planner_jobs_failed_total",
  help: "Total planning jobs that failed.",
  labelNames: ["failureCode"],
  registers: [metricsRegistry]
});

const plannerStageDurationSeconds = new Histogram({
  name: "planner_stage_duration_seconds",
  help: "Duration of each planner stage execution, in seconds.",
  labelNames: ["stage"],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600],
  registers: [metricsRegistry]
});

const plannerStageFailuresTotal = new Counter({
  name: "planner_stage_failures_total",
  help: "Total stage execution failures.",
  labelNames: ["stage", "reason"],
  registers: [metricsRegistry]
});

const plannerLlmRequestsTotal = new Counter({
  name: "planner_llm_requests_total",
  help: "Total LLM requests issued by the planner.",
  labelNames: ["provider", "stage"],
  registers: [metricsRegistry]
});

const plannerLlmTokensTotal = new Counter({
  name: "planner_llm_tokens_total",
  help: "Total LLM tokens consumed by the planner.",
  labelNames: ["provider", "stage", "kind"],
  registers: [metricsRegistry]
});

const plannerRevisionCycles = new Histogram({
  name: "planner_revision_cycles",
  help: "Number of revision cycles a plan required before reaching a terminal state.",
  buckets: [0, 1, 2, 3, 4, 5, 6, 8, 10, 15],
  registers: [metricsRegistry]
});

const plannerQualityScore = new Gauge({
  name: "planner_quality_score",
  help: "Most recent overall critic quality score observed, per plan.",
  labelNames: ["planId"],
  registers: [metricsRegistry]
});

const plannerPlanGateFindingsTotal = new Counter({
  name: "planner_plan_gate_findings_total",
  help: "Total plan gate findings raised, by rule and severity.",
  labelNames: ["ruleId", "severity"],
  registers: [metricsRegistry]
});

const plannerPlanGateDecisionsTotal = new Counter({
  name: "planner_plan_gate_decisions_total",
  help: "Total plan gate stage decisions, by outcome.",
  labelNames: ["decision"],
  registers: [metricsRegistry]
});

const plannerImplementationPublishTotal = new Counter({
  name: "planner_implementation_publish_total",
  help: "Total attempts to publish a passed plan to the implementation orchestrator, by outcome.",
  labelNames: ["status"],
  registers: [metricsRegistry]
});

export function recordJobQueued(): void {
  plannerJobsTotal.inc();
}

export function recordJobCompleted(): void {
  plannerJobsCompletedTotal.inc();
}

export function recordJobFailed(failureCode: string): void {
  plannerJobsFailedTotal.inc({ failureCode });
}

export function recordStageDuration(stage: string, durationMs: number): void {
  plannerStageDurationSeconds.observe({ stage }, durationMs / 1000);
}

export function recordStageFailure(stage: string, reason: string): void {
  plannerStageFailuresTotal.inc({ stage, reason });
}

export function recordLlmRequest(provider: string, stage: string): void {
  plannerLlmRequestsTotal.inc({ provider, stage });
}

export function recordLlmTokens(
  provider: string,
  stage: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null | undefined
): void {
  if (!usage) return;
  if (usage.promptTokens) plannerLlmTokensTotal.inc({ provider, stage, kind: "prompt" }, usage.promptTokens);
  if (usage.completionTokens) {
    plannerLlmTokensTotal.inc({ provider, stage, kind: "completion" }, usage.completionTokens);
  }
  if (usage.totalTokens) plannerLlmTokensTotal.inc({ provider, stage, kind: "total" }, usage.totalTokens);
}

export function recordRevisionCycles(count: number): void {
  plannerRevisionCycles.observe(count);
}

export function recordQualityScore(planId: string, score: number): void {
  plannerQualityScore.set({ planId }, score);
}

export function recordPlanGateFinding(ruleId: string, severity: string): void {
  plannerPlanGateFindingsTotal.inc({ ruleId, severity });
}

export function recordPlanGateDecision(decision: string): void {
  plannerPlanGateDecisionsTotal.inc({ decision });
}

export function recordImplementationPublish(status: "published" | "failed"): void {
  plannerImplementationPublishTotal.inc({ status });
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return {
    contentType: metricsRegistry.contentType,
    body: await metricsRegistry.metrics()
  };
}
