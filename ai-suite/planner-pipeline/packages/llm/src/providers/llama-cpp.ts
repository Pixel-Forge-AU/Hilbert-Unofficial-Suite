import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * llama.cpp's `server` binary exposes an OpenAI-compatible
 * `/v1/chat/completions` endpoint, so only the provider id differs.
 */
export class LlamaCppProvider extends OpenAICompatibleProvider {
  override readonly id = "llama.cpp";
}
