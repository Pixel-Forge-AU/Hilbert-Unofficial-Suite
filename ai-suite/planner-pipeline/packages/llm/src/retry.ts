export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * Checked before every attempt (including the first) and again after a failure before
   * deciding to retry. Without this, an abort that happens between attempts - rather than
   * during the in-flight one - goes unnoticed: a fresh, non-aborted request just gets fired
   * anyway, silently defeating the abort.
   */
  abortSignal?: AbortSignal;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (options.abortSignal?.aborted) throw lastError ?? options.abortSignal.reason ?? new Error("Aborted");
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || options.abortSignal?.aborted) break;
      const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.25));
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }
  }
  throw lastError;
}
