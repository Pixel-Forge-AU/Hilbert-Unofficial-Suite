export interface RetryDecisionInput {
  attemptsSoFar: number;
  maxBuilderAttempts: number;
  globalRetriesUsed: number;
  globalRetryBudget: number;
}

export type RetryDecision =
  | { action: "retry"; backoffSeconds: number }
  | { action: "fail"; reason: string };

const BASE_BACKOFF_SECONDS = 5;
const MAX_BACKOFF_SECONDS = 300;

export function computeBackoffSeconds(attemptNumber: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** attemptNumber);
}

export function decideRetry(input: RetryDecisionInput): RetryDecision {
  if (input.attemptsSoFar >= input.maxBuilderAttempts) {
    return {
      action: "fail",
      reason: `Task exceeded its maximum builder attempts (${input.maxBuilderAttempts}).`,
    };
  }
  if (input.globalRetriesUsed >= input.globalRetryBudget) {
    return {
      action: "fail",
      reason: `Workflow exceeded its global retry budget (${input.globalRetryBudget}).`,
    };
  }
  return { action: "retry", backoffSeconds: computeBackoffSeconds(input.attemptsSoFar) };
}
