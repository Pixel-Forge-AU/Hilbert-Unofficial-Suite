import { OpenAICompatibleProvider } from "./openai-compatible.js";

export class OllamaProvider extends OpenAICompatibleProvider {
  override readonly id = "ollama";
}
