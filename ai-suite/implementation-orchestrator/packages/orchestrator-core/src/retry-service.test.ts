import { describe, expect, it } from "vitest";
import { computeBackoffSeconds, decideRetry } from "./retry-service.js";

describe("computeBackoffSeconds", () => {
  it("grows exponentially with attempt number", () => {
    expect(computeBackoffSeconds(0)).toBe(5);
    expect(computeBackoffSeconds(1)).toBe(10);
    expect(computeBackoffSeconds(2)).toBe(20);
  });

  it("caps at the maximum backoff", () => {
    expect(computeBackoffSeconds(10)).toBe(300);
  });
});

describe("decideRetry", () => {
  it("allows a retry when within both budgets", () => {
    const decision = decideRetry({
      attemptsSoFar: 1,
      maxBuilderAttempts: 3,
      globalRetriesUsed: 2,
      globalRetryBudget: 12,
    });
    expect(decision.action).toBe("retry");
  });

  it("fails when the task's own attempt budget is exhausted", () => {
    const decision = decideRetry({
      attemptsSoFar: 3,
      maxBuilderAttempts: 3,
      globalRetriesUsed: 0,
      globalRetryBudget: 12,
    });
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining("maximum builder attempts") });
  });

  it("fails when the workflow's global retry budget is exhausted, even with task budget remaining", () => {
    const decision = decideRetry({
      attemptsSoFar: 0,
      maxBuilderAttempts: 3,
      globalRetriesUsed: 12,
      globalRetryBudget: 12,
    });
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining("global retry budget") });
  });
});
