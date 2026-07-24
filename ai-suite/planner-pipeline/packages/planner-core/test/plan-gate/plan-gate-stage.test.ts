import type {
  LlmProvider,
  ProviderHealth,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
  TextGenerationRequest,
  TextGenerationResponse
} from "@planner/llm";
import { createTokenBudget } from "@planner/llm";
import { describe, expect, it } from "vitest";
import { PlanGateStage } from "../../src/plan-gate/plan-gate-stage.js";
import type { PlannerContext, StageRuntime } from "../../src/stage.js";
import { VALID_STAGE_OUTPUTS } from "../fixtures/valid-stage-outputs.js";
import { cloneManifest, goldenManifest } from "./golden-manifest.js";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger
};

class StubProvider implements LlmProvider {
  readonly id = "stub";
  calls = 0;

  constructor(private readonly adjudicationResponse: { outcome: "confirmed" | "dismissed" }) {}

  async generateText(): Promise<TextGenerationResponse> {
    throw new Error("not implemented");
  }

  async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResponse<T>> {
    this.calls += 1;
    const value = {
      adjudications: [
        {
          findingId: "dep-essential-depends-on-deferred:F001:F002",
          outcome: this.adjudicationResponse.outcome,
          rationale: "test rationale"
        }
      ]
    } as unknown as T;
    return { value, rawText: JSON.stringify(value), raw: value, repairCount: 0 };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true, message: "stub" };
  }
}

function runtimeWith(provider: LlmProvider): StageRuntime {
  return {
    planId: "plan_test",
    attempt: 1,
    model: provider,
    abortSignal: new AbortController().signal,
    logger: silentLogger,
    tokenBudget: createTokenBudget(4_000)
  };
}

function manifestWithAmbiguousDependency() {
  const manifest = cloneManifest(goldenManifest());
  const second = cloneManifest(goldenManifest()).features[0]!;
  second.id = "F002";
  second.name = "Shape-similarity search";
  manifest.features.push(second);
  manifest.features[0]!.dependencies = ["F002"];
  manifest.scope.classifications.push({
    itemId: "F002",
    itemName: "Shape-similarity search",
    scopeClass: "experimental",
    rationale: "test",
    cheaperAlternative: null,
    isSignatureElement: false
  });
  return manifest;
}

function contextFor(manifest: ReturnType<typeof goldenManifest>): PlannerContext {
  return {
    plan: {},
    previousOutputs: { final_manifest: manifest, plan_critic: VALID_STAGE_OUTPUTS.plan_critic },
    revisionRequests: []
  };
}

describe("PlanGateStage", () => {
  it("passes cleanly without invoking the adjudicator for a clean manifest", async () => {
    const stage = new PlanGateStage();
    const provider = new StubProvider({ outcome: "confirmed" });
    const input = await stage.buildInput(contextFor(goldenManifest()));
    const output = await stage.execute(input, runtimeWith(provider));

    expect(output.decision).toBe("passed");
    expect(output.adjudicationUsed).toBe(false);
    expect(provider.calls).toBe(0);
  });

  it("invokes the adjudicator and reflects a confirmed outcome", async () => {
    const stage = new PlanGateStage();
    const provider = new StubProvider({ outcome: "confirmed" });
    const input = await stage.buildInput(contextFor(manifestWithAmbiguousDependency()));
    const output = await stage.execute(input, runtimeWith(provider));

    expect(provider.calls).toBe(1);
    expect(output.adjudicationUsed).toBe(true);
    expect(output.decision).toBe("passed_with_warnings");
    expect(output.warningCount).toBe(1);
  });

  it("invokes the adjudicator and excludes a dismissed finding from the decision", async () => {
    const stage = new PlanGateStage();
    const provider = new StubProvider({ outcome: "dismissed" });
    const input = await stage.buildInput(contextFor(manifestWithAmbiguousDependency()));
    const output = await stage.execute(input, runtimeWith(provider));

    expect(provider.calls).toBe(1);
    expect(output.adjudicationUsed).toBe(true);
    expect(output.decision).toBe("passed");
    expect(output.warningCount).toBe(0);
  });

  it("throws when the manifest is missing from previousOutputs", async () => {
    const stage = new PlanGateStage();
    await expect(
      stage.buildInput({
        plan: {},
        previousOutputs: { plan_critic: VALID_STAGE_OUTPUTS.plan_critic },
        revisionRequests: []
      })
    ).rejects.toThrow(/manifest/);
  });
});
