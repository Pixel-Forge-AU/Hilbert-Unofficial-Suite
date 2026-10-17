import type { UnresolvedDecision } from "@planner/contracts";
import { describe, expect, it } from "vitest";
import { classifyUnresolvedDecision } from "../../src/plan-gate/unresolved-decision-classifier.js";

function decision(overrides: Partial<UnresolvedDecision>): UnresolvedDecision {
  return {
    id: "UD1",
    decision: "Placeholder decision",
    options: ["A", "B"],
    recommendation: "A",
    blockedBy: "awaiting stakeholder input",
    ...overrides
  };
}

describe("classifyUnresolvedDecision", () => {
  it("classifies authentication/payment/database decisions as implementation_blocking", () => {
    const result = classifyUnresolvedDecision(
      decision({ decision: "Should we use Stripe or PayPal for our payment gateway?" })
    );
    expect(result.impact).toBe("implementation_blocking");
    expect(result.ambiguous).toBe(false);
  });

  it("classifies copy/icon/colour decisions as informational", () => {
    const result = classifyUnresolvedDecision(decision({ decision: "What icon style should empty states use?" }));
    expect(result.impact).toBe("informational");
    expect(result.ambiguous).toBe(false);
  });

  it("classifies sequencing/pricing/onboarding decisions as phase_blocking", () => {
    const result = classifyUnresolvedDecision(
      decision({ decision: "Should the onboarding flow be 3 steps or 5 steps?" })
    );
    expect(result.impact).toBe("phase_blocking");
    expect(result.ambiguous).toBe(false);
  });

  it("defaults to task_local, non-ambiguous, for the golden fixture's decision text", () => {
    const result = classifyUnresolvedDecision(
      decision({
        decision: "Should search history persist across sessions?",
        options: ["Yes, persist per account", "No, session-only"]
      })
    );
    expect(result.impact).toBe("task_local");
    expect(result.ambiguous).toBe(false);
  });

  it("flags borderline keywords (integration/provider/vendor/migration/compliance/platform) as ambiguous", () => {
    const result = classifyUnresolvedDecision(
      decision({ decision: "Which mapping provider should we use for displaying part locations?" })
    );
    expect(result.impact).toBe("task_local");
    expect(result.ambiguous).toBe(true);
  });
});
