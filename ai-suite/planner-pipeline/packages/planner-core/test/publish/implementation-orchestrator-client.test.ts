import type { PlanGateResult } from "@planner/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImplementationOrchestratorPublishError,
  publishToImplementationOrchestrator
} from "../../src/publish/implementation-orchestrator-client.js";
import { VALID_STAGE_OUTPUTS } from "../fixtures/valid-stage-outputs.js";
import { compileBuildManifest } from "../../src/output-compiler.js";
import { goldenProject } from "../plan-gate/golden-manifest.js";

const planGate: PlanGateResult = VALID_STAGE_OUTPUTS.plan_gate;

function baseArgs() {
  return {
    title: "Searchable 3D parts library",
    manifest: compileBuildManifest(goldenProject, VALID_STAGE_OUTPUTS),
    planGate,
    planId: "plan_test123",
    target: {
      repository: { url: "git@github.com:example/project.git", baseBranch: "main" },
      policyProfile: "default-safe",
      builderProfile: "mock"
    }
  };
}

describe("publishToImplementationOrchestrator", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /v1/workflows with the expected shape and returns the workflowId on success", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ workflowId: "wf-123", status: "created" })
    });

    const result = await publishToImplementationOrchestrator(baseArgs());

    expect(result).toEqual({ workflowId: "wf-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/v1/workflows");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Searchable 3D parts library");
    expect(body.manifest.manifestId).toBe("plan_test123");
    expect(body.manifest.planGate.decision).toBe("passed");
    expect(body.repository).toEqual(baseArgs().target.repository);
    expect(body.policyProfile).toBe("default-safe");
    expect(body.builderProfile).toBe("mock");
  });

  it("throws ImplementationOrchestratorPublishError on a non-2xx response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
      json: async () => ({})
    });

    await expect(publishToImplementationOrchestrator(baseArgs())).rejects.toThrow(
      ImplementationOrchestratorPublishError
    );
  });

  it("throws ImplementationOrchestratorPublishError on a network error", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(publishToImplementationOrchestrator(baseArgs())).rejects.toThrow(
      ImplementationOrchestratorPublishError
    );
  });
});
