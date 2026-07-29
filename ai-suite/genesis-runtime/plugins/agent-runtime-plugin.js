// Extracted (in substantially simplified form, not a mechanical line-for-line port) from
// genesis-core's largest cluster: the task queue / agent execution runtime. That cluster is
// ~44 files and ~19,000 lines (observer-execution-runner.js, observer-queue-processor.js,
// observer-task-*.js, observer-worker-*.js, tool-loop-*.js, intake-*.js, and more) — deeply
// specific to Nova's brain/persona/mail/project-cycle model. Porting it 1:1 would mean
// reproducing Nova's product behavior wholesale, which isn't what "infrastructure, not
// behaviour" extraction calls for.
//
// What this plugin DOES provide, faithfully capturing the *shape* of the original (task
// statuses, file-backed queue, a dispatch loop, a tool-calling execution loop, a lightweight
// intake/triage split) as a genuinely usable but much smaller reference implementation:
//   - task storage + lifecycle (queued/in_progress/waiting/done/failed), one JSON record per
//     task under this plugin's own data store (see observer-task-storage.js for the pattern
//     this mirrors)
//   - a queue dispatch loop (see observer-queue-processor.js)
//   - a tool-calling execution loop against a "brain:generate" capability (see
//     observer-execution-runner.js / observer-worker-prompting.js for the pattern)
//   - a minimal intake/triage split: reply directly vs. enqueue a task (see
//     intake-planner-service.js / intake-routing-domain.js for the pattern)
//   - simple interval-based cron scheduling that enqueues tasks (see cron-domain.js)
//
// EXPLICITLY NOT PORTED (left for a dedicated follow-up, not silently dropped): opportunity
// scanning, escalation-review retry heuristics, helper-scout/maintenance jobs, the
// "recreation" reflective job, Nova's elaborate native chat-response builders (calendar/
// finance/inbox summaries — those depend on domains like calendar/finance that were never
// part of Nova's *infrastructure* either), and tool-loop-repair-helpers' sandbox-specific
// JSON-repair heuristics. These are autonomous personal-assistant *product* behaviors, not
// generic orchestration infrastructure.
//
// Tool-invocation convention: any plugin that wants a tool it registers via
// api.registerTool({name, ...}) (metadata/discovery only — core does not dispatch tool calls)
// to actually be *callable* by this runtime should also provide a capability named
// "tool:<name>" whose handler executes the tool given its parsed arguments. None of the
// pilot plugins built alongside this one (homeassistant, skills, ...) were retrofitted with
// that convention yet — that's a known follow-up, noted in the final extraction report.

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 150, // load after model-provider/sandbox/workspace/memory
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: ["tasks:create", "tasks:get", "tasks:list", "agent:run"],
    hooks: [],
    runtimeContext: [],
    tools: ["web_fetch"]
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: {
    requiredCapabilities: [],
    optionalCapabilities: ["brain:generate", "brain:generate-json"]
  },
  security: { isolation: "inprocess" }
};

const STATUSES = ["queued", "in_progress", "waiting", "done", "failed"];
const MAX_TOOL_LOOP_ITERATIONS = 6;
const DISPATCH_INTERVAL_MS = 3000;
const CRON_TICK_INTERVAL_MS = 30000;

function nowIso() {
  return new Date().toISOString();
}

function makeTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return STATUSES.includes(normalized) ? normalized : "queued";
}

// A conservative parser for a model response that may contain a JSON tool call
// ({"tool": "name", "args": {...}}) embedded in otherwise free-form text.
function extractToolCall(text = "") {
  const match = String(text || "").match(/\{[^{}]*"tool"\s*:\s*"[^"]+"[^{}]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed.tool === "string" && parsed.tool.trim()) {
      return { tool: parsed.tool.trim(), args: parsed.args && typeof parsed.args === "object" ? parsed.args : {} };
    }
  } catch {
    // not valid JSON — treat as a plain-text final answer
  }
  return null;
}

export default function createAgentRuntimePlugin() {
  let api = null;
  let dispatchTimer = null;
  let cronTimer = null;
  let dispatching = false;

  function requireCapability(name) {
    const handler = api.getCapability(name);
    if (typeof handler !== "function") {
      throw new Error(`required capability "${name}" is not available (is the plugin that provides it installed?)`);
    }
    return handler;
  }

  async function loadIndex() {
    return (await api.data.readJson("index", { taskIds: [] })) || { taskIds: [] };
  }

  async function saveTask(task) {
    await api.data.writeJson(`tasks/${task.id}`, task);
    return task;
  }

  async function getTask(taskId = "") {
    const id = String(taskId || "").trim();
    if (!id) return null;
    return api.data.readJson(`tasks/${id}`, null);
  }

  async function listTasks({ status = "" } = {}) {
    const index = await loadIndex();
    const tasks = (await Promise.all(index.taskIds.map((id) => getTask(id)))).filter(Boolean);
    const normalizedStatus = normalizeStatus(status || "") === "queued" && !status ? "" : normalizeStatus(status);
    return normalizedStatus ? tasks.filter((task) => task.status === normalizedStatus) : tasks;
  }

  async function createTask({ request = "", brainId = "" } = {}) {
    const text = String(request || "").trim();
    if (!text) throw new Error("request text is required");
    const task = {
      id: makeTaskId(),
      status: "queued",
      request: text,
      brainId: String(brainId || "").trim(),
      transcript: [],
      result: null,
      error: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await saveTask(task);
    const index = await loadIndex();
    index.taskIds.push(task.id);
    await api.data.writeJson("index", index);
    api.broadcast(`[genesis] task ${task.id} queued`);
    return task;
  }

  async function transitionTask(taskId, patch = {}) {
    const task = await getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const next = { ...task, ...patch, updatedAt: nowIso() };
    await saveTask(next);
    return next;
  }

  // --- Execution loop -------------------------------------------------

  async function runToolCall(name, args) {
    const handler = api.getCapability(`tool:${name}`);
    if (typeof handler !== "function") {
      return { ok: false, error: `no plugin provides a "tool:${name}" capability` };
    }
    try {
      return { ok: true, result: await handler(args) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err || "tool call failed") };
    }
  }

  async function toolWebFetch({ url = "", method = "GET" } = {}) {
    if (!url) throw new Error("url is required");
    const response = await fetch(url, { method: String(method || "GET").toUpperCase() });
    const text = await response.text();
    return { status: response.status, ok: response.ok, body: text.slice(0, 8000) };
  }

  async function executeTask(task) {
    const generate = api.getCapability("brain:generate");
    if (typeof generate !== "function") {
      await transitionTask(task.id, {
        status: "failed",
        error: 'no "brain:generate" capability is available — install a model-provider plugin'
      });
      return;
    }

    const systemPrompt = [
      "You are an autonomous task-execution agent.",
      "Respond with plain text to finish the task, OR respond with a single JSON object",
      '{"tool": "<tool_name>", "args": { ... }} to call a tool and see its result before finishing.',
      `Built-in tools: web_fetch({url, method}). Other tools may be available via plugins.`
    ].join(" ");

    const transcript = Array.isArray(task.transcript) ? task.transcript.slice() : [];
    transcript.push({ role: "system", content: systemPrompt, at: nowIso() });
    transcript.push({ role: "user", content: task.request, at: nowIso() });

    let finalText = "";
    for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
      let response;
      try {
        response = await generate({
          brainId: task.brainId || undefined,
          messages: transcript.map(({ role, content }) => ({ role, content }))
        });
      } catch (err) {
        await transitionTask(task.id, { status: "failed", error: String(err?.message || err || "generation failed"), transcript });
        return;
      }
      const responseText = typeof response === "string" ? response : String(response?.text || response?.content || "");
      transcript.push({ role: "assistant", content: responseText, at: nowIso() });

      const toolCall = extractToolCall(responseText);
      if (!toolCall) {
        finalText = responseText;
        break;
      }
      const toolResult = toolCall.tool === "web_fetch"
        ? { ok: true, result: await toolWebFetch(toolCall.args).catch((err) => ({ error: String(err?.message || err) })) }
        : await runToolCall(toolCall.tool, toolCall.args);
      transcript.push({
        role: "tool",
        content: JSON.stringify({ tool: toolCall.tool, ...toolResult }),
        at: nowIso()
      });
    }

    await transitionTask(task.id, {
      status: finalText ? "done" : "failed",
      result: finalText ? { text: finalText } : null,
      error: finalText ? "" : "tool loop exhausted without a final answer",
      transcript
    });
    api.broadcast(`[genesis] task ${task.id} ${finalText ? "completed" : "failed"}`);
  }

  async function dispatchNext() {
    if (dispatching) return;
    dispatching = true;
    try {
      const queued = await listTasks({ status: "queued" });
      if (!queued.length) return;
      const next = queued.sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))[0];
      await transitionTask(next.id, { status: "in_progress" });
      const task = await getTask(next.id);
      await executeTask(task);
    } catch (err) {
      api.broadcast(`[genesis] dispatch error: ${String(err?.message || err)}`);
    } finally {
      dispatching = false;
    }
  }

  // --- Intake / triage --------------------------------------------------

  async function handleIntakeMessage({ text = "" } = {}) {
    const message = String(text || "").trim();
    if (!message) throw new Error("text is required");
    const generateJson = api.getCapability("brain:generate-json") || api.getCapability("brain:generate");
    if (typeof generateJson !== "function") {
      // No model provider installed — fall back to always queueing.
      const task = await createTask({ request: message });
      return { action: "queue", taskId: task.id };
    }
    let decision;
    try {
      const raw = await generateJson({
        messages: [
          { role: "system", content: 'Decide whether this message needs background work (respond {"action":"queue"}) or can be answered directly in one short reply (respond {"action":"reply","replyText":"..."}). Respond with JSON only.' },
          { role: "user", content: message }
        ]
      });
      const text2 = typeof raw === "string" ? raw : String(raw?.text || raw?.content || "{}");
      decision = JSON.parse(text2.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {
      decision = { action: "queue" };
    }
    if (decision?.action === "reply" && decision?.replyText) {
      return { action: "reply", replyText: String(decision.replyText) };
    }
    const task = await createTask({ request: message });
    return { action: "queue", taskId: task.id };
  }

  // --- Cron ---------------------------------------------------------------

  async function loadCronJobs() {
    return (await api.data.readJson("cron-jobs", { jobs: [] })) || { jobs: [] };
  }

  async function cronTick() {
    const state = await loadCronJobs();
    const now = Date.now();
    let changed = false;
    for (const job of state.jobs) {
      if (Number(job.nextRunAt || 0) > now) continue;
      changed = true;
      job.lastRunAt = now;
      job.nextRunAt = now + Math.max(60000, Number(job.intervalMs || 3600000));
      await createTask({ request: job.directive, brainId: job.brainId || "" }).catch(() => {});
    }
    if (changed) await api.data.writeJson("cron-jobs", state);
  }

  return {
    id: "agent-runtime",
    name: "Agent Runtime",
    version: "0.1.0",
    description: "Task queue, tool-calling execution loop, intake/triage, and cron scheduling — the minimal generic core of an autonomous agent runtime.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;

      api.provideCapability("tasks:create", async (args = {}) => createTask(args));
      api.provideCapability("tasks:get", async ({ taskId } = {}) => getTask(taskId));
      api.provideCapability("tasks:list", async (args = {}) => listTasks(args));
      api.provideCapability("agent:run", async ({ request, brainId } = {}) => {
        const task = await createTask({ request, brainId });
        await executeTask(await getTask(task.id));
        return getTask(task.id);
      });

      api.registerTool({
        name: "web_fetch",
        description: "Fetch a URL and return its status and truncated body text.",
        parameters: { type: "object", properties: { url: { type: "string" }, method: { type: "string" } }, required: ["url"] }
      });

      startTimers();
    },

    async registerRoutes({ app }) {
      app.post("/api/tasks", async (req, res) => {
        try {
          res.json({ ok: true, task: await createTask(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to create task") });
        }
      });

      app.get("/api/tasks", async (req, res) => {
        try {
          res.json({ ok: true, tasks: await listTasks({ status: req.query?.status }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to list tasks") });
        }
      });

      app.get("/api/tasks/:taskId", async (req, res) => {
        const task = await getTask(req.params?.taskId);
        if (!task) return res.status(404).json({ ok: false, error: "task not found" });
        res.json({ ok: true, task });
      });

      app.post("/api/tasks/:taskId/abort", async (req, res) => {
        try {
          res.json({ ok: true, task: await transitionTask(req.params?.taskId, { status: "failed", error: "aborted by user" }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to abort task") });
        }
      });

      app.post("/api/agent/message", async (req, res) => {
        try {
          res.json({ ok: true, ...(await handleIntakeMessage(req.body || {})) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to handle message") });
        }
      });

      app.get("/api/cron", async (_req, res) => {
        res.json({ ok: true, ...(await loadCronJobs()) });
      });

      app.post("/api/cron", async (req, res) => {
        try {
          const state = await loadCronJobs();
          const job = {
            id: `cron-${Date.now().toString(36)}`,
            directive: String(req.body?.directive || "").trim(),
            intervalMs: Math.max(60000, Number(req.body?.intervalMs || 3600000)),
            brainId: String(req.body?.brainId || "").trim(),
            lastRunAt: 0,
            nextRunAt: Date.now()
          };
          if (!job.directive) throw new Error("directive is required");
          state.jobs.push(job);
          await api.data.writeJson("cron-jobs", state);
          res.json({ ok: true, job });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to add cron job") });
        }
      });

      app.delete("/api/cron/:jobId", async (req, res) => {
        const state = await loadCronJobs();
        const before = state.jobs.length;
        state.jobs = state.jobs.filter((job) => job.id !== req.params?.jobId);
        await api.data.writeJson("cron-jobs", state);
        res.json({ ok: true, removed: before !== state.jobs.length });
      });
    },

    async onDisable() {
      if (dispatchTimer) clearInterval(dispatchTimer);
      if (cronTimer) clearInterval(cronTimer);
      dispatchTimer = null;
      cronTimer = null;
    },

    async onEnable() {
      startTimers();
    }
  };

  function startTimers() {
    if (dispatchTimer || cronTimer) return;
    dispatchTimer = setInterval(() => { dispatchNext().catch(() => {}); }, DISPATCH_INTERVAL_MS);
    cronTimer = setInterval(() => { cronTick().catch(() => {}); }, CRON_TICK_INTERVAL_MS);
  }
}
