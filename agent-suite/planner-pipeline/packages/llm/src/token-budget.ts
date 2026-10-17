export interface TokenBudget {
  instruction: number;
  context: number;
  expectedOutput: number;
  retryReserve: number;
}

export function createTokenBudget(maxOutputTokens: number): TokenBudget {
  return {
    instruction: 2_000,
    context: Math.max(4_000, Math.floor(maxOutputTokens * 0.8)),
    expectedOutput: maxOutputTokens,
    retryReserve: Math.max(1_000, Math.floor(maxOutputTokens * 0.25))
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function assertWithinBudget(label: string, text: string, maxTokens: number): void {
  const estimate = estimateTokens(text);
  if (estimate > maxTokens) {
    throw new Error(`${label} exceeds token budget: estimated ${estimate}, allowed ${maxTokens}`);
  }
}
