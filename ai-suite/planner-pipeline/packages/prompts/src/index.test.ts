import { EDGE_CASE_MINIMUMS } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { buildStagePrompt } from "./index.js";

describe("buildStagePrompt revision section", () => {
  it("renders current revision requests filtered to this stage, ahead of everything else", () => {
    const prompt = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      revisionRequests: [
        {
          section: "scope.classifications",
          problem: "Mobile scope contradiction.",
          requiredChange: "Resolve it.",
          responsibleStage: "scope_challenger",
          severity: "blocking"
        },
        {
          section: "architecture",
          problem: "Unrelated systems_architect issue.",
          requiredChange: "Not for this stage.",
          responsibleStage: "systems_architect",
          severity: "major"
        }
      ]
    }).prompt;

    expect(prompt).toContain("THIS IS A REVISION");
    expect(prompt).toContain("Mobile scope contradiction.");
    expect(prompt).not.toContain("Unrelated systems_architect issue.");
    expect(prompt.indexOf("Mobile scope contradiction.")).toBeLessThan(prompt.indexOf("Global rules:"));
  });

  it("omits the revision section entirely when there is nothing to say", () => {
    const prompt = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {}
    }).prompt;

    expect(prompt).not.toContain("THIS IS A REVISION");
  });
});

describe("buildStagePrompt patch mode", () => {
  const previousStageOutput = {
    classifications: [{ itemId: "F001", itemName: "Combat", scopeClass: "essential" }],
    minimumCompleteProduct: ["F001"],
    recommendedFirstRelease: ["F001"],
    premiumRelease: [],
    experiments: [],
    deferredItems: [],
    rejectedItems: [],
    sequencingRationale: ["Core loop first."],
    scopeRisks: []
  };

  it("switches to patch mode only when a revision request AND a previous output are both present", () => {
    const withBoth = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      previousStageOutput,
      revisionRequests: [
        {
          section: "scope.classifications",
          problem: "Mobile scope contradiction.",
          requiredChange: "Fix it.",
          responsibleStage: "scope_challenger",
          severity: "blocking"
        }
      ]
    });
    expect(withBoth.isPatch).toBe(true);

    const noRevisionRequest = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      previousStageOutput
    });
    expect(noRevisionRequest.isPatch).toBe(false);

    const noPreviousOutput = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      revisionRequests: [
        {
          section: "scope.classifications",
          problem: "Mobile scope contradiction.",
          requiredChange: "Fix it.",
          responsibleStage: "scope_challenger",
          severity: "blocking"
        }
      ]
    });
    expect(noPreviousOutput.isPatch).toBe(false);
  });

  it("includes the previous output and instructs omitting unchanged fields", () => {
    const prompt = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      previousStageOutput,
      revisionRequests: [
        {
          section: "scope.classifications",
          problem: "Mobile scope contradiction.",
          requiredChange: "Fix it.",
          responsibleStage: "scope_challenger",
          severity: "blocking"
        }
      ]
    }).prompt;

    expect(prompt).toContain("PATCH MODE");
    expect(prompt).toContain("ONLY the top-level field(s) that must change");
    expect(prompt).toContain('"itemId": "F001"');
    expect(prompt).toContain("Mobile scope contradiction.");
  });
});

describe("buildStagePrompt edge_case_hunter category minimums", () => {
  it("spells out every category's minimum finding count in prose, since the JSON schema can't express it", () => {
    // EDGE_CASE_MINIMUMS is enforced by a Zod .superRefine() on the full report, which
    // zod-to-json-schema cannot serialize - the schema block in the prompt only shows
    // "findings: array, min 1 item", with no per-category counts at all. Without this text,
    // a model has no way to learn the real requirement exists (this was a real production
    // failure: a model produced 20 well-formed "behaviour" findings and stopped, never
    // attempting the other six categories).
    const prompt = buildStagePrompt("edge_case_hunter", { plan: {}, previousOutputs: {} }).prompt;

    for (const [category, minimum] of Object.entries(EDGE_CASE_MINIMUMS)) {
      expect(prompt).toContain(`"${category}": at least ${minimum} findings`);
    }
  });
});

describe("buildStagePrompt resolved issues section", () => {
  it("renders older resolved issues as a 'previously fixed, don't reintroduce' reminder", () => {
    const prompt = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      resolvedIssues: [
        {
          section: "scope.classifications",
          problem: "Deferred item lacked a rationale.",
          requiredChange: "Add a one-sentence rationale to every deferred item.",
          responsibleStage: "scope_challenger",
          severity: "major"
        }
      ]
    }).prompt;

    expect(prompt).toContain("PREVIOUSLY FIXED - DO NOT REINTRODUCE");
    expect(prompt).toContain("Deferred item lacked a rationale.");
    expect(prompt).toContain("Add a one-sentence rationale to every deferred item.");
  });

  it("omits the section entirely when there are no resolved issues for this stage", () => {
    const prompt = buildStagePrompt("scope_challenger", { plan: {}, previousOutputs: {} }).prompt;

    expect(prompt).not.toContain("PREVIOUSLY FIXED");
  });

  it("excludes a resolved issue from the reminder when it's also the current cycle's active revision request, to avoid double-listing", () => {
    const sharedProblem = "Mobile scope contradiction.";
    const prompt = buildStagePrompt("scope_challenger", {
      plan: {},
      previousOutputs: {},
      resolvedIssues: [
        {
          section: "scope.classifications",
          problem: sharedProblem,
          requiredChange: "An earlier, now-superseded fix attempt.",
          responsibleStage: "scope_challenger",
          severity: "major"
        }
      ],
      revisionRequests: [
        {
          section: "scope.classifications",
          problem: sharedProblem,
          requiredChange: "The current fix to apply.",
          responsibleStage: "scope_challenger",
          severity: "blocking"
        }
      ]
    }).prompt;

    expect(prompt).not.toContain("PREVIOUSLY FIXED");
    expect(prompt).toContain("THIS IS A REVISION");
    expect(prompt).toContain("The current fix to apply.");
  });
});
