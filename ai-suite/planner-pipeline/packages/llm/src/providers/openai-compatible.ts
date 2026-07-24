import { generateStructuredWithRepair } from "../structured-output.js";
import { withRetry } from "../retry.js";
import type {
  LlmProvider,
  ProviderHealth,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
  TextGenerationRequest,
  TextGenerationResponse
} from "../provider.js";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string = "openai-compatible";

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const attempts = Number(process.env.PLANNER_MODEL_RETRY_COUNT ?? 3);
    return withRetry(() => this.generateTextOnce(request), {
      attempts,
      baseDelayMs: 500,
      maxDelayMs: 5_000,
      abortSignal: request.abortSignal
    });
  }

  private async generateTextOnce(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    // An abort that lands between retry attempts (rather than during this one) only sets
    // .aborted - the "abort" event that the listener below reacts to already fired in the
    // past and won't fire again, so a fresh AbortController here would never learn about it.
    // Checking .aborted directly up front is what makes a stale abort actually stop a retry
    // loop instead of silently starting a brand new request anyway.
    if (request.abortSignal?.aborted) {
      throw request.abortSignal.reason ?? new Error("Request aborted before starting.");
    }
    const baseUrl = request.profile.baseUrl ?? process.env.DEFAULT_LLM_BASE_URL;
    if (!baseUrl) {
      throw new Error("No LLM base URL configured.");
    }
    const apiKeyEnv = request.profile.apiKeyEnv ?? "DEFAULT_LLM_API_KEY";
    const apiKey = process.env[apiKeyEnv] ?? process.env.DEFAULT_LLM_API_KEY;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.profile.timeoutMs);
    request.abortSignal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Forces a fresh TCP connection instead of reusing undici's keep-alive pool - a
          // long-lived process making many large, slow requests to a remote server that
          // occasionally restarts/reloads models is exactly the scenario where a pooled
          // socket can go stale (killed server-side without the client's pool noticing) and
          // surface as a generic, hard-to-diagnose "fetch failed" on the next reuse (observed
          // repeatedly in production - see [[project_ftl_babylonjs_pipeline_run]]). A brand
          // new connection per request costs a TCP/TLS handshake, negligible next to these
          // requests' multi-second-to-minute durations.
          connection: "close",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: request.profile.model,
          temperature: request.profile.temperature,
          top_p: request.profile.topP,
          max_tokens: request.profile.maxOutputTokens,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`LLM request failed with ${response.status}: ${await response.text()}`);
      }
      const json = (await response.json()) as ChatCompletionResponse;
      const text = json.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error("LLM response did not include message content.");
      }
      return {
        text,
        raw: json,
        tokenUsage: {
          promptTokens: json.usage?.prompt_tokens,
          completionTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResponse<T>> {
    return generateStructuredWithRepair(this, request);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: Boolean(process.env.DEFAULT_LLM_BASE_URL), message: "OpenAI-compatible provider configured" };
  }
}
