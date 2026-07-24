import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "../src/quality-gate.js";

describe("quality gate", () => {
  it("rejects low-scoring critiques", () => {
    const result = evaluateQualityGate(
      {
        passed: false,
        overallScore: 70,
        categoryScores: {
          creativity: 90,
          completeness: 90,
          uxDefinition: 90,
          visualDefinition: 90,
          technicalDepth: 90,
          testability: 90,
          consistency: 90,
          feasibility: 90,
          accessibility: 90,
          resilience: 90
        },
        blockingIssues: [],
        majorIssues: [],
        minorIssues: [],
        contradictions: [],
        genericLanguageFindings: [],
        missingSections: [],
        revisionRequests: [],
        summary: "Needs work."
      },
      { project: {} } as never,
      { strictness: 9, creativity: 9, detailLevel: 10, targetQualityScore: 92, maxRevisionCycles: 4 }
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
