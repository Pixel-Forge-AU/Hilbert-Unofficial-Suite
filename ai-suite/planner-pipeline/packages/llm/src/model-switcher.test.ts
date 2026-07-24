import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("modelKeyForStage", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("routes known precision stages to the precision model and everything else to the general model", async () => {
    delete process.env.PLANNER_PRECISION_STAGES;
    delete process.env.PLANNER_PRECISION_MODEL;
    delete process.env.PLANNER_GENERAL_MODEL;
    const { modelKeyForStage } = await import("./model-switcher.js");

    expect(modelKeyForStage("systems_architect")).toBe("qwen3-coder-next-80b");
    expect(modelKeyForStage("feature_expander")).toBe("qwen3-coder-next-80b");
    expect(modelKeyForStage("edge_case_hunter")).toBe("qwen3-coder-next-80b");
    expect(modelKeyForStage("specification_compiler")).toBe("qwen3-coder-next-80b");
    expect(modelKeyForStage("plan_critic")).toBe("qwen3.6-35b-a3b-heretic");
    expect(modelKeyForStage("concept_generator")).toBe("qwen3.6-35b-a3b-heretic");
  });

  it("honours PLANNER_PRECISION_STAGES/PLANNER_PRECISION_MODEL/PLANNER_GENERAL_MODEL overrides", async () => {
    process.env.PLANNER_PRECISION_STAGES = "plan_critic";
    process.env.PLANNER_PRECISION_MODEL = "custom-precision";
    process.env.PLANNER_GENERAL_MODEL = "custom-general";
    const { modelKeyForStage } = await import("./model-switcher.js");

    expect(modelKeyForStage("plan_critic")).toBe("custom-precision");
    expect(modelKeyForStage("systems_architect")).toBe("custom-general");
  });
});

describe("ensureModelLoaded", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does nothing when LLM_MANAGEMENT_BASE_URL is not configured", async () => {
    delete process.env.LLM_MANAGEMENT_BASE_URL;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { ensureModelLoaded } = await import("./model-switcher.js");

    await ensureModelLoaded("qwen3-coder-next-80b");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("switches and polls the actual inference endpoint (not the management API's chat health) until the expected model is confirmed loaded", async () => {
    process.env.LLM_MANAGEMENT_BASE_URL = "http://mgmt.example";
    process.env.DEFAULT_LLM_BASE_URL = "http://infer.example/v1";
    process.env.LLM_MANAGEMENT_POLL_INTERVAL_MS = "1";
    const fetchSpy = vi
      .fn()
      // switch call
      .mockResolvedValueOnce({ ok: true } as Response)
      // first readiness poll: server still restarting
      .mockResolvedValueOnce({ ok: false } as Response)
      // second readiness poll: the inference endpoint now reports the right model
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "qwen3-coder-next-q5_k_m" }] })
      } as Response);
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { ensureModelLoaded } = await import("./model-switcher.js");

    await ensureModelLoaded("qwen3-coder-next-80b");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://mgmt.example/api/performance/models/switch/main",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenCalledWith("http://infer.example/v1/models");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("skips the switch call entirely when the requested model is already the last one ensured", async () => {
    process.env.LLM_MANAGEMENT_BASE_URL = "http://mgmt.example";
    process.env.DEFAULT_LLM_BASE_URL = "http://infer.example/v1";
    process.env.LLM_MANAGEMENT_POLL_INTERVAL_MS = "1";
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "qwen3-coder-next-q5_k_m" }] })
    } as Response);
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { ensureModelLoaded } = await import("./model-switcher.js");

    await ensureModelLoaded("qwen3-coder-next-80b");
    const callCountAfterFirst = fetchSpy.mock.calls.length;
    await ensureModelLoaded("qwen3-coder-next-80b");

    expect(fetchSpy.mock.calls.length).toBe(callCountAfterFirst);
  });
});
