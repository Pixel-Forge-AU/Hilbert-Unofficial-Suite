/**
 * Optional per-stage model routing against a single llama.cpp instance that can only run
 * one model at a time. Planner stages already execute strictly sequentially (never in
 * parallel), so swapping the one loaded model between stage groups is safe - there's never
 * a moment where two stages need two different models simultaneously.
 *
 * Entirely opt-in: if LLM_MANAGEMENT_BASE_URL isn't set, ensureModelLoaded() is a no-op and
 * every stage keeps using whatever's already loaded (the pre-existing, single-model
 * behaviour), so this can't change anything for a deployment that hasn't configured it.
 */

export interface ManagedModel {
  alias: string;
  path: string;
  ctx: string;
  gpuLayers: string;
  extraArgs: string;
}

/**
 * Known models this pipeline has actually exercised successfully, keyed by a short id used
 * in PLANNER_PRECISION_STAGES/PLANNER_GENERAL_MODEL/PLANNER_PRECISION_MODEL. Deliberately
 * limited to models with a real track record in this pipeline rather than the full
 * ai-suite catalog - untested, slow, or not-yet-tuned models (e.g. the 120B/284B entries)
 * are a stability risk to introduce into the critical path of an unattended run.
 */
export const MANAGED_MODELS: Record<string, ManagedModel> = {
  "qwen3.6-35b-a3b-heretic": {
    alias: "qwen3.6-35b-a3b-uncensored-heretic-q4_k_m",
    path: "/home/hilbert/ai-suite/models/qwen3.6-35b-a3b-heretic/Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M.gguf",
    ctx: "131072",
    gpuLayers: "999",
    extraArgs: "--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1"
  },
  "qwen3-coder-next-80b": {
    alias: "qwen3-coder-next-q5_k_m",
    path: "/home/hilbert/ai-suite/models/qwen3-coder-next/Qwen3-Coder-Next-Q5_K_M/Qwen3-Coder-Next-Q5_K_M-00001-of-00004.gguf",
    ctx: "131072",
    gpuLayers: "999",
    extraArgs: "--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1"
  }
};

/**
 * Stages that benefit from a coding/structure-precision model (strict JSON schemas, high
 * finding volume, technical architecture detail) rather than the general/creative default.
 * Configurable via PLANNER_PRECISION_STAGES (comma-separated stage names) so this can be
 * tuned without a code change; falls back to this default set.
 */
const DEFAULT_PRECISION_STAGES = new Set([
  "systems_architect",
  "feature_expander",
  "edge_case_hunter",
  "specification_compiler"
]);

export function modelKeyForStage(stageName: string): string {
  const precisionStages = process.env.PLANNER_PRECISION_STAGES
    ? new Set(process.env.PLANNER_PRECISION_STAGES.split(",").map((s) => s.trim()))
    : DEFAULT_PRECISION_STAGES;
  const precisionModel = process.env.PLANNER_PRECISION_MODEL ?? "qwen3-coder-next-80b";
  const generalModel = process.env.PLANNER_GENERAL_MODEL ?? "qwen3.6-35b-a3b-heretic";
  return precisionStages.has(stageName) ? precisionModel : generalModel;
}

let lastEnsuredAlias: string | null = null;

/**
 * Switches the single "main" model slot if the stage's required model isn't already loaded,
 * then waits for the health endpoint to report ready. In-memory lastEnsuredAlias avoids a
 * redundant switch call on every stage within the same run; it resets on process restart,
 * but a follow-up switch to the model that's already loaded is a harmless no-op on the
 * server side, not a correctness issue.
 */
export async function ensureModelLoaded(modelKey: string): Promise<void> {
  const managementBaseUrl = process.env.LLM_MANAGEMENT_BASE_URL;
  if (!managementBaseUrl) return;

  const managed = MANAGED_MODELS[modelKey];
  if (!managed) throw new Error(`Unknown managed model key "${modelKey}".`);
  if (lastEnsuredAlias === managed.alias) return;

  const switchResponse = await fetch(`${managementBaseUrl.replace(/\/$/, "")}/api/performance/models/switch/main`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: managed.path,
      alias: managed.alias,
      ctx: managed.ctx,
      gpu_layers: managed.gpuLayers,
      extra_args: managed.extraArgs
    })
  });
  if (!switchResponse.ok) {
    throw new Error(`Model switch to "${modelKey}" failed with ${switchResponse.status}: ${await switchResponse.text()}`);
  }

  await waitForModelReady(managed.alias);
  lastEnsuredAlias = managed.alias;
}

/**
 * Polls the actual inference endpoint (DEFAULT_LLM_BASE_URL, e.g. port 39001's /v1/models) -
 * not the management API's /api/chat/health (port 39000). That health endpoint reflects a
 * separate "chat" convenience routing profile that can point at an entirely different
 * backend (observed live: an unrelated small Ollama model) independent of what's actually
 * loaded in the "main" slot our requests hit, so it's not a reliable signal that the switch
 * this function is waiting on has actually taken effect.
 */
async function waitForModelReady(
  expectedAlias: string,
  timeoutMs = Number(process.env.LLM_MANAGEMENT_TIMEOUT_MS ?? 300_000),
  pollIntervalMs = Number(process.env.LLM_MANAGEMENT_POLL_INTERVAL_MS ?? 3_000)
): Promise<void> {
  const inferenceBaseUrl = process.env.DEFAULT_LLM_BASE_URL;
  if (!inferenceBaseUrl) {
    throw new Error("DEFAULT_LLM_BASE_URL must be set to verify a model switch took effect.");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${inferenceBaseUrl.replace(/\/$/, "")}/models`);
      if (response.ok) {
        const body = (await response.json()) as { data?: Array<{ id?: string }> };
        if (body.data?.[0]?.id === expectedAlias) return;
      }
    } catch {
      // Server is mid-restart during a switch - keep polling rather than failing on the
      // first connection error, matching the "Loading model" 503 pattern observed live.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Model "${expectedAlias}" did not become ready within ${timeoutMs}ms after switching.`);
}
