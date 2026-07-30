// Reinterprets observer-escalation-review.js for Genesis: the original retries a failed
// task on a distinct "remote triage" brain, a concept from Nova's worker/intake/helper
// brain-kind routing that agent-runtime-plugin.js deliberately doesn't have. Genesis has no
// notion of a dedicated "triage" brain — but model-provider-plugin.js does maintain a real
// registry of multiple named brains via brain:list, so "escalate to a different brain" is
// still a meaningful, generic operation: when a task exhausts its retries on one brain,
// spin up a fresh attempt on any other available brain instead of just giving up.
//
// This listens on agent-runtime-plugin.js's "task:retry-exhausted" hook (an extension
// point, not a place this logic had to be hardcoded) purely as an observer — it does NOT
// set `handled: true`, so the original task still gets marked failed normally rather than
// left lingering in a non-terminal state. It reacts by queueing a fresh, independent task
// for the same request on a different brain, noting the escalation in its own audit log.

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 160, // after agent-runtime (150) and model-provider
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [],
    hooks: ["task:retry-exhausted"],
    runtimeContext: []
  },
  dependencies: {
    requiredCapabilities: [],
    optionalCapabilities: ["tasks:create", "brain:list"]
  },
  security: { isolation: "inprocess" }
};

export default function createEscalationReviewPlugin() {
  let api = null;

  async function loadLog() {
    return (await api.data.readJson("escalations", { entries: [] })) || { entries: [] };
  }

  async function appendLog(entry) {
    const log = await loadLog();
    log.entries.push({ at: new Date().toISOString(), ...entry });
    log.entries = log.entries.slice(-200);
    await api.data.writeJson("escalations", log);
  }

  async function onRetryExhausted(payload = {}) {
    const task = payload?.task;
    if (!task?.id || !task?.request) return payload;

    const createTask = api.getCapability("tasks:create");
    const listBrains = api.getCapability("brain:list");
    if (typeof createTask !== "function" || typeof listBrains !== "function") {
      await appendLog({
        taskId: task.id,
        outcome: "skipped",
        reason: "tasks:create or brain:list capability unavailable"
      });
      return payload;
    }

    let brains = [];
    try {
      brains = await listBrains({ includeDisabled: false }) || [];
    } catch {
      brains = [];
    }
    const failedBrainId = String(task.brainId || "").trim();
    const alternate = (Array.isArray(brains) ? brains : []).find((brain) => String(brain?.id || "").trim() && String(brain.id).trim() !== failedBrainId);

    if (!alternate) {
      await appendLog({
        taskId: task.id,
        outcome: "skipped",
        reason: failedBrainId
          ? `no alternate brain registered besides "${failedBrainId}"`
          : "no alternate brain registered"
      });
      return payload;
    }

    const escalated = await createTask({ request: task.request, brainId: alternate.id });
    await appendLog({
      taskId: task.id,
      outcome: "escalated",
      fromBrainId: failedBrainId || "(none)",
      toBrainId: alternate.id,
      escalatedTaskId: escalated.id
    });
    api.broadcast(`[escalation-review] task ${task.id} exhausted retries; escalated as ${escalated.id} on brain "${alternate.id}"`);
    return payload;
  }

  return {
    id: "escalation-review",
    name: "Escalation Review",
    version: "0.1.0",
    description: "When a task exhausts its retries, escalate it to a different registered brain instead of giving up.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      api.addHook("task:retry-exhausted", onRetryExhausted);
    },

    async registerRoutes({ app }) {
      app.get("/api/escalation-review/log", async (_req, res) => {
        res.json({ ok: true, ...(await loadLog()) });
      });
    }
  };
}
