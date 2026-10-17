import type { z } from "zod";

export interface ModelProfile {
  id: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  temperature: number;
  topP?: number;
  maxOutputTokens: number;
  timeoutMs: number;
  supportsJsonSchema: boolean;
}

export interface TextGenerationRequest {
  profile: ModelProfile;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}

export interface TextGenerationResponse {
  text: string;
  raw: unknown;
  tokenUsage?: TokenUsage;
}

export interface StructuredGenerationRequest<T> extends TextGenerationRequest {
  schema: z.ZodType<T>;
  schemaName: string;
  repairAttempts?: number;
}

export interface StructuredGenerationResponse<T> {
  value: T;
  rawText: string;
  raw: unknown;
  tokenUsage?: TokenUsage;
  repairCount: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
}

export interface LlmProvider {
  id: string;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResponse<T>>;
  healthCheck(): Promise<ProviderHealth>;
}
