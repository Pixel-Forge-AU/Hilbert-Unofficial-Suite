import { describe, expect, it } from "vitest";
import { createProvider } from "./index.js";
import { LlamaCppProvider } from "./providers/llama-cpp.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";

describe("createProvider", () => {
  it("selects a distinct provider instance per provider id", () => {
    expect(createProvider("openai-compatible")).toBeInstanceOf(OpenAICompatibleProvider);
    expect(createProvider("ollama")).toBeInstanceOf(OllamaProvider);
    expect(createProvider("llama.cpp")).toBeInstanceOf(LlamaCppProvider);
  });

  it("reports a provider-specific id used for metrics and logging", () => {
    expect(createProvider("ollama").id).toBe("ollama");
    expect(createProvider("llama.cpp").id).toBe("llama.cpp");
    expect(createProvider("openai-compatible").id).toBe("openai-compatible");
  });
});
