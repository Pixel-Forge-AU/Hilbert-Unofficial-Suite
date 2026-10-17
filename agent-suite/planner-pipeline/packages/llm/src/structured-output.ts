import type { z } from "zod";
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
  TextGenerationRequest
} from "./provider.js";

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const starts = [...candidate.matchAll(/[\[{]/g)].map((match) => match.index).filter((index) => index !== undefined);
  for (const start of starts) {
    const end = findJsonEnd(candidate, start);
    if (end === null) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  throw new Error("Model response contained JSON-like text that could not be parsed.");
}

function findJsonEnd(text: string, start: number): number | null {
  const opener = text[start];
  const expectedCloser = opener === "{" ? "}" : opener === "[" ? "]" : null;
  if (!expectedCloser) return null;

  const stack: string[] = [expectedCloser];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return null;
      if (stack.length === 0) return index;
    }
  }

  return null;
}

export function parseStructured<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(extractJson(text));
}

/**
 * Thrown when generateStructuredWithRepair exhausts its repair budget. Carries the final
 * attempt's raw text/token usage so callers (e.g. the orchestrator's RecordingProvider) can
 * still persist what the model actually produced for debugging - without this, a stage that
 * fails after several repair rounds has its diagnostic output silently lost even though the
 * validation error message itself is preserved.
 */
export class StructuredGenerationError extends Error {
  constructor(
    originalError: unknown,
    public readonly rawText: string,
    public readonly tokenUsage: unknown
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError), { cause: originalError });
    this.name = "StructuredGenerationError";
  }
}

export async function generateStructuredWithRepair<T>(
  provider: LlmProvider,
  request: StructuredGenerationRequest<T>
): Promise<StructuredGenerationResponse<T>> {
  const repairAttempts = request.repairAttempts ?? Number(process.env.PLANNER_SCHEMA_REPAIR_COUNT ?? 2);
  let currentPrompt = request.prompt;
  let rawText = "";
  let raw: unknown;
  let tokenUsage = undefined;
  for (let repairCount = 0; repairCount <= repairAttempts; repairCount += 1) {
    const response = await provider.generateText({ ...request, prompt: currentPrompt });
    rawText = response.text;
    raw = response.raw;
    tokenUsage = response.tokenUsage;
    try {
      return {
        value: parseStructured(request.schema, response.text),
        rawText,
        raw,
        tokenUsage,
        repairCount
      };
    } catch (error) {
      if (repairCount === repairAttempts) {
        throw new StructuredGenerationError(error, rawText, tokenUsage);
      }
      currentPrompt = buildRepairPrompt(request, response.text, error);
    }
  }
  throw new Error("Structured generation failed unexpectedly.");
}

function buildRepairPrompt<T>(
  request: TextGenerationRequest & { schemaName: string },
  invalidResponse: string,
  error: unknown
): string {
  return [
    request.prompt,
    "",
    "The previous response failed schema validation.",
    `Schema name: ${request.schemaName}`,
    `Validation error: ${error instanceof Error ? error.message : String(error)}`,
    "Return only corrected JSON. Do not include markdown fences or commentary.",
    "Invalid response:",
    invalidResponse
  ].join("\n");
}
