export * from "./provider.js";
export * from "./providers/llama-cpp.js";
export * from "./providers/ollama.js";
export * from "./providers/openai-compatible.js";
export * from "./retry.js";
export * from "./structured-output.js";
export * from "./token-budget.js";
export * from "./model-switcher.js";

import type { LlmProvider, ModelProfile } from "./provider.js";
import { LlamaCppProvider } from "./providers/llama-cpp.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { MANAGED_MODELS, modelKeyForStage } from "./model-switcher.js";

export function defaultModelProfile(stageId: string): ModelProfile {
  // When per-stage routing is configured (LLM_MANAGEMENT_BASE_URL set), each stage's model
  // name reflects whichever managed model it actually needs - orchestrator.ts calls
  // ensureModelLoaded() before execution so the server has that model loaded by the time
  // this profile's baseUrl is actually hit. Unconfigured, this resolves to the single
  // DEFAULT_LLM_MODEL exactly as before.
  const routedModel = process.env.LLM_MANAGEMENT_BASE_URL
    ? MANAGED_MODELS[modelKeyForStage(stageId)]?.alias
    : undefined;
  return {
    id: `${stageId}:default`,
    provider: process.env.DEFAULT_LLM_PROVIDER ?? "openai-compatible",
    model: routedModel ?? process.env.DEFAULT_LLM_MODEL ?? "gpt-4.1",
    baseUrl: process.env.DEFAULT_LLM_BASE_URL,
    apiKeyEnv: "DEFAULT_LLM_API_KEY",
    temperature: Number(process.env.PLANNER_MODEL_TEMPERATURE ?? 0.6),
    maxOutputTokens: Number(process.env.PLANNER_MODEL_MAX_OUTPUT_TOKENS ?? 12_000),
    timeoutMs: Number(process.env.PLANNER_STAGE_TIMEOUT_MS ?? 300_000),
    supportsJsonSchema: false
  };
}

export function adjudicatorModelProfile(): ModelProfile {
  return {
    id: "plan_gate_adjudicator:default",
    provider: process.env.DEFAULT_LLM_PROVIDER ?? "openai-compatible",
    model: process.env.PLAN_GATE_ADJUDICATOR_MODEL ?? process.env.DEFAULT_LLM_MODEL ?? "gpt-4.1",
    baseUrl: process.env.DEFAULT_LLM_BASE_URL,
    apiKeyEnv: "DEFAULT_LLM_API_KEY",
    temperature: Number(process.env.PLAN_GATE_ADJUDICATOR_TEMPERATURE ?? 0.2),
    maxOutputTokens: Number(process.env.PLAN_GATE_ADJUDICATOR_MAX_OUTPUT_TOKENS ?? 4_000),
    timeoutMs: Number(process.env.PLANNER_STAGE_TIMEOUT_MS ?? 300_000),
    supportsJsonSchema: false
  };
}

export function createProvider(providerId = process.env.DEFAULT_LLM_PROVIDER ?? "openai-compatible"): LlmProvider {
  if (providerId === "ollama") return new OllamaProvider();
  if (providerId === "llama.cpp") return new LlamaCppProvider();
  return new OpenAICompatibleProvider();
}
