import {
  generateStructuredWithRepair,
  type LlmProvider,
  type ProviderHealth,
  type StructuredGenerationRequest,
  type StructuredGenerationResponse,
  type TextGenerationRequest,
  type TextGenerationResponse
} from "@planner/llm";
import type { PlannerStageName } from "@planner/contracts";
import { VALID_STAGE_OUTPUTS } from "./valid-stage-outputs.js";

export type ScriptedResponse =
  | { kind: "valid" }
  | { kind: "value"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "error"; error: Error };

interface ScriptedStep {
  response: ScriptedResponse;
  /** Runs after the response is chosen but before it is returned — used to simulate a concurrent cancel/instruction. */
  sideEffect?: () => Promise<void>;
  /** Simulates a slow model response; rejects early with the abort reason if request.abortSignal fires during the wait. */
  delayMs?: number;
}

/**
 * Deterministic, in-memory LlmProvider for driving the orchestrator end-to-end
 * in tests without a real model endpoint. By default every stage resolves to
 * its schema-valid fixture from valid-stage-outputs.ts; individual stages can
 * be scripted with a one-shot queue of responses, falling back to a persistent
 * override (setDefault) and finally to the built-in valid fixture.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly id = "fake";
  readonly calls: { schemaName?: string; prompt: string }[] = [];

  private readonly queues = new Map<string, ScriptedStep[]>();
  private readonly defaults = new Map<string, ScriptedResponse>();

  script(schemaName: string, steps: ScriptedStep[]): void {
    this.queues.set(schemaName, [...steps]);
  }

  setDefault(schemaName: string, response: ScriptedResponse): void {
    this.defaults.set(schemaName, response);
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const schemaName = (request as Partial<StructuredGenerationRequest<unknown>>).schemaName;
    this.calls.push({ schemaName, prompt: request.prompt });

    const queued = schemaName ? this.queues.get(schemaName)?.shift() : undefined;
    const defaultResponse = schemaName ? this.defaults.get(schemaName) : undefined;
    const step: ScriptedStep = queued ?? { response: defaultResponse ?? { kind: "valid" } };

    if (step.sideEffect) await step.sideEffect();

    if (step.delayMs) {
      await new Promise<void>((resolve, reject) => {
        if (request.abortSignal?.aborted) {
          reject(request.abortSignal.reason);
          return;
        }
        const timer = setTimeout(resolve, step.delayMs);
        request.abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(request.abortSignal!.reason);
          },
          { once: true }
        );
      });
    }

    const response = step.response;
    if (response.kind === "error") throw response.error;

    const tokenUsage = { promptTokens: 100, completionTokens: 100, totalTokens: 200 };
    if (response.kind === "text") return { text: response.text, raw: null, tokenUsage };
    if (response.kind === "value") return { text: JSON.stringify(response.value), raw: null, tokenUsage };

    // Patch-mode requests use schemaName `${stage}_patch`, which has no entry in
    // VALID_STAGE_OUTPUTS. Unscripted patch requests default to an empty patch (no fields
    // changed) rather than throwing, so existing tests that only care about a revision cycle
    // completing - not the patched content - don't need to script every stage's patch response.
    if (schemaName?.endsWith("_patch") && !VALID_STAGE_OUTPUTS[schemaName as PlannerStageName]) {
      return { text: "{}", raw: null, tokenUsage };
    }

    const fixture = schemaName ? VALID_STAGE_OUTPUTS[schemaName as PlannerStageName] : undefined;
    if (!fixture) {
      throw new Error(`FakeLlmProvider has no default fixture for schema "${schemaName}".`);
    }
    return { text: JSON.stringify(fixture), raw: null, tokenUsage };
  }

  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResponse<T>> {
    return generateStructuredWithRepair(this, request);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true, message: "fake provider" };
  }
}
