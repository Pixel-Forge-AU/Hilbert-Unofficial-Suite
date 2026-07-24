import { describe, expect, it } from "vitest";
import {
  metricsRegistry,
  recordJobCompleted,
  recordJobFailed,
  recordJobQueued,
  recordLlmRequest,
  recordLlmTokens,
  recordQualityScore,
  recordRevisionCycles,
  recordStageDuration,
  recordStageFailure,
  renderMetrics
} from "./metrics.js";

describe("planner metrics", () => {
  it("exposes every metric named in the specification", async () => {
    recordJobQueued();
    recordJobCompleted();
    recordJobFailed("QUALITY_THRESHOLD_NOT_REACHED");
    recordStageDuration("intent_interpreter", 1500);
    recordStageFailure("intent_interpreter", "invalid_output");
    recordLlmRequest("openai-compatible", "intent_interpreter");
    recordLlmTokens("openai-compatible", "intent_interpreter", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150
    });
    recordRevisionCycles(2);
    recordQualityScore("plan_test", 93);

    const { contentType, body } = await renderMetrics();
    expect(contentType).toContain("text/plain");
    for (const name of [
      "planner_jobs_total",
      "planner_jobs_completed_total",
      "planner_jobs_failed_total",
      "planner_stage_duration_seconds",
      "planner_stage_failures_total",
      "planner_llm_requests_total",
      "planner_llm_tokens_total",
      "planner_revision_cycles",
      "planner_quality_score"
    ]) {
      expect(body).toContain(name);
    }
  });

  it("does nothing when token usage is absent", async () => {
    metricsRegistry.resetMetrics();
    recordLlmTokens("openai-compatible", "intent_interpreter", undefined);
    const { body } = await renderMetrics();
    expect(body).not.toMatch(/planner_llm_tokens_total\{[^}]*\} [1-9]/);
  });
});
