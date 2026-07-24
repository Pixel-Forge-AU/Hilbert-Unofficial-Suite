import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.DEFAULT_LLM_BASE_URL;
const originalRetryCount = process.env.PLANNER_MODEL_RETRY_COUNT;

function restoreEnv(key: string, value: string | undefined): void {
  // Assigning `undefined` to a process.env property coerces it to the literal string
  // "undefined" rather than clearing it - a real bug this file had until a second test
  // exposed it: Number("undefined") is NaN, which silently zeroes out a for-loop's bound
  // and throws `undefined` instead of a real error.
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("DEFAULT_LLM_BASE_URL", originalBaseUrl);
  restoreEnv("PLANNER_MODEL_RETRY_COUNT", originalRetryCount);
  vi.restoreAllMocks();
});

describe("OpenAICompatibleProvider", () => {
  it("retries transient transport failures", async () => {
    process.env.DEFAULT_LLM_BASE_URL = "http://llm.test/v1";
    process.env.PLANNER_MODEL_RETRY_COUNT = "2";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleProvider();
    const response = await provider.generateText({
      profile: {
        id: "test",
        provider: "openai-compatible",
        model: "test-model",
        temperature: 0,
        maxOutputTokens: 100,
        timeoutMs: 10_000,
        supportsJsonSchema: false
      },
      system: "system",
      prompt: "prompt"
    });

    expect(response.text).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends Connection: close so a long-lived process never reuses a stale pooled socket", async () => {
    process.env.DEFAULT_LLM_BASE_URL = "http://llm.test/v1";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleProvider();
    await provider.generateText({
      profile: {
        id: "test",
        provider: "openai-compatible",
        model: "test-model",
        temperature: 0,
        maxOutputTokens: 100,
        timeoutMs: 10_000,
        supportsJsonSchema: false
      },
      system: "system",
      prompt: "prompt"
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).connection).toBe("close");
  });
});
