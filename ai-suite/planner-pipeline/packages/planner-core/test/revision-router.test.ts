import { describe, expect, it } from "vitest";
import { routeRevisions } from "../src/revision-router.js";

describe("revision router", () => {
  it("routes from the earliest responsible stage", () => {
    const route = routeRevisions({
      passed: false,
      overallScore: 80,
      categoryScores: {
        creativity: 90,
        completeness: 90,
        uxDefinition: 90,
        visualDefinition: 80,
        technicalDepth: 75,
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
      revisionRequests: [
        {
          section: "architecture.APIs",
          problem: "API ownership unclear.",
          requiredChange: "Assign owners.",
          responsibleStage: "systems_architect",
          severity: "major"
        },
        {
          section: "features.F001.states",
          problem: "Offline state missing.",
          requiredChange: "Add offline recovery.",
          responsibleStage: "feature_expander",
          severity: "major"
        }
      ],
      summary: "Rerun needed."
    });
    expect(route.earliestStage).toBe("feature_expander");
    expect(route.stagesToRerun[0]).toBe("feature_expander");
  });
});
