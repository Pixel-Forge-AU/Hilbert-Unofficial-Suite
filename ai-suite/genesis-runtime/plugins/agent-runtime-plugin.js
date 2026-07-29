// Faithfully ported (adapted, not a mechanical line-for-line copy) from genesis-core's
// largest cluster: the task queue / agent execution runtime (observer-task-storage.js,
// observer-task-lifecycle-service.js, observer-queue-processor.js,
// observer-execution-runner.js, observer-worker-prompting.js, intake-*.js — ~30 files,
// ~17,400 lines). The original is saturated with Nova-specific brain-kind routing
// (worker/intake/helper roles, specialist-brain selection, creative-handoff brain choice,
// hardware-tied queue lanes) that has no Genesis equivalent — Genesis treats every brain a
// model-provider plugin exposes as interchangeable, so all of that routing is dropped here
// (documented, not silently lost) in favor of porting the actual mechanism faithfully:
//   - real file-backed task storage + lifecycle (queued/in_progress/waiting/done/failed),
//     one JSON record per task under this plugin's own data store (see
//     observer-task-storage.js for the pattern this mirrors)
//   - a real queue dispatch loop with an in-flight guard and stale in_progress recovery
//     (see observer-queue-processor.js's processNextQueuedTask/recoverStaleInProgressTasks)
//   - a real tool-calling execution loop against the "brain:generate" capability, including
//     a waiting_for_user pause/resume path (see observer-execution-runner.js's
//     buildPermissionApprovalWaitingResponse for the pattern this mirrors) and cooperative
//     task cancellation (see abortActiveTask/forceStopTask)
//   - task history/breadcrumbs per transition (see recordTaskBreadcrumb's pattern)
//   - a minimal intake/triage split: reply directly vs. enqueue a task (see
//     intake-planner-service.js / intake-routing-domain.js for the pattern)
//   - simple interval-based cron scheduling that enqueues tasks (see cron-domain.js)
//
// EXPLICITLY NOT PORTED (deferred to a dedicated follow-up phase, not silently dropped):
// opportunity scanning, escalation-review retry heuristics, helper-scout/maintenance jobs,
// the "recreation" reflective job, Nova's elaborate native chat-response builders (calendar/
// finance/inbox summaries — those depend on domains like calendar/finance that were never
// part of Nova's *infrastructure* either), tool-loop-repair-helpers' sandbox-specific
// JSON-repair heuristics, and the intake/routing cluster's fuller heuristics
// (observer-request-heuristics.js, observer-native-support.js, observer-prompt-utils.js).
// These are autonomous personal-assistant *product* behaviors, not generic orchestration
// infrastructure, and/or a large enough cluster to warrant their own porting pass.
//
// Tool-invocation convention: any plugin that wants a tool it registers via
// api.registerTool({name, ...}) (metadata/discovery only — core does not dispatch tool calls)
// to actually be *callable* by this runtime should also provide a capability named
// "tool:<name>" whose handler executes the tool given its parsed arguments. None of the
// pilot plugins built alongside this one (homeassistant, skills, ...) were retrofitted with
// that convention yet — that's a known follow-up, noted in the final extraction report.
//
// task-lifecycle-plugin.js is the thin API-shim over this plugin's capabilities (matching
// the same runtimeContext -> capability-delegation fix already applied in
// developer-tools-plugin.js) — it owns the Nova-shaped /api/plugins/tasks/* HTTP surface,
// this plugin owns the actual queue/storage/execution mechanism.

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 150, // load after model-provider/sandbox/workspace/memory
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: ["tasks:create", "tasks:get", "tasks:list", "tasks:stop", "tasks:answer", "tasks:history", "agent:run"],
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
const STALE_IN_PROGRESS_MS = 5 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 50;

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

// Mirrors observer-execution-runner.js's buildPermissionApprovalWaitingResponse pattern:
// the model can pause a task and ask the user a clarifying question instead of finishing
// or calling a tool, by responding {"waiting_for_user": true, "question": "..."}.
function extractWaitingForUser(text = "") {
  const match = String(text || "").match(/\{[^{}]*"waiting_for_user"\s*:\s*true[^{}]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const question = String(parsed?.question || "").trim();
    return question ? { question } : null;
  } catch {
    return null;
  }
}

function appendHistory(task, entry = {}) {
  const history = Array.isArray(task.history) ? task.history.slice() : [];
  history.push({ at: nowIso(), ...entry });
  task.history = history.slice(-MAX_HISTORY_ENTRIES);
  return task;
}

export default function createAgentRuntimePlugin() {
  let api = null;
  let dispatchTimer = null;
  let cronTimer = null;
  let dispatching = false;
  // taskId -> { abortRequested: boolean }. Best-effort cooperative cancellation: a running
  // executeTask() checks this between tool-loop iterations. It cannot interrupt a single
  // in-flight brain:generate() call (the capability contract has no cancellation signal),
  // but force=true immediately closes the task record regardless, mirroring
  // observer-task-lifecycle-service.js's forceStopTask semantics.
  const activeControllers = new Map();

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
      waitingForUser: false,
      questionForUser: "",
      history: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null
    };
    appendHistory(task, { eventType: "task.created", toStatus: "queued", reason: "Task created." });
    await saveTask(task);
    const index = await loadIndex();
    index.taskIds.push(task.id);
    await api.data.writeJson("index", index);
    api.broadcast(`[genesis] task ${task.id} queued`);
    return task;
  }

  async function transitionTask(taskId, patch = {}, { eventType = "task.updated", reason = "" } = {}) {
    const task = await getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const fromStatus = task.status;
    const next = { ...task, ...patch, updatedAt: nowIso() };
    if (patch.status && patch.status !== fromStatus) {
      appendHistory(next, { eventType, fromStatus, toStatus: patch.status, reason });
    }
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
        completedAt: nowIso(),
        error: 'no "brain:generate" capability is available — install a model-provider plugin'
      }, { eventType: "task.failed", reason: "brain:generate capability unavailable" });
      return;
    }

    const control = { abortRequested: false, force: false };
    activeControllers.set(task.id, control);

    const systemPrompt = [
      "You are an autonomous task-execution agent.",
      "Respond with plain text to finish the task, OR respond with a single JSON object",
      '{"tool": "<tool_name>", "args": { ... }} to call a tool and see its result before finishing,',
      'OR respond with {"waiting_for_user": true, "question": "..."} to pause and ask the user',
      "a clarifying question before continuing.",
      "Built-in tools: web_fetch({url, method}). Other tools may be available via plugins."
    ].join(" ");

    const transcript = Array.isArray(task.transcript) ? task.transcript.slice() : [];
    transcript.push({ role: "system", content: systemPrompt, at: nowIso() });
    transcript.push({ role: "user", content: task.request, at: nowIso() });

    try {
      let finalText = "";
      let waiting = null;
      for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
        if (control.abortRequested) {
          await transitionTask(task.id, {
            status: "failed",
            completedAt: nowIso(),
            error: "aborted by user",
            transcript
          }, { eventType: "task.failed", reason: "Aborted by user." });
          return;
        }
        let response;
        try {
          response = await generate({
            brainId: task.brainId || undefined,
            messages: transcript.map(({ role, content }) => ({ role, content }))
          });
        } catch (err) {
          await transitionTask(task.id, {
            status: "failed",
            completedAt: nowIso(),
            error: String(err?.message || err || "generation failed"),
            transcript
          }, { eventType: "task.failed", reason: "Generation failed." });
          return;
        }
        const responseText = typeof response === "string" ? response : String(response?.text || response?.content || "");
        transcript.push({ role: "assistant", content: responseText, at: nowIso() });

        waiting = extractWaitingForUser(responseText);
        if (waiting) break;

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

      if (waiting) {
        await transitionTask(task.id, {
          status: "waiting",
          waitingForUser: true,
          questionForUser: waiting.question,
          transcript
        }, { eventType: "task.waiting", reason: waiting.question });
        api.broadcast(`[genesis] task ${task.id} waiting for user input`);
        return;
      }

      await transitionTask(task.id, {
        status: finalText ? "done" : "failed",
        completedAt: nowIso(),
        result: finalText ? { text: finalText } : null,
        error: finalText ? "" : "tool loop exhausted without a final answer",
        transcript
      }, {
        eventType: finalText ? "task.completed" : "task.failed",
        reason: finalText ? "Task completed." : "Tool loop exhausted without a final answer."
      });
      api.broadcast(`[genesis] task ${task.id} ${finalText ? "completed" : "failed"}`);
    } finally {
      activeControllers.delete(task.id);
    }
  }

  async function answerTask({ taskId = "", answer = "" } = {}) {
    const id = String(taskId || "").trim();
    const text = String(answer || "").trim();
    if (!id) throw new Error("taskId is required");
    if (!text) throw new Error("answer is required");
    const task = await getTask(id);
    if (!task) throw new Error(`task ${id} not found`);
    if (task.status !== "waiting") throw new Error(`task ${id} is not waiting for user input`);
    const transcript = Array.isArray(task.transcript) ? task.transcript.slice() : [];
    transcript.push({ role: "user", content: text, at: nowIso() });
    return transitionTask(id, {
      status: "queued",
      waitingForUser: false,
      questionForUser: "",
      transcript
    }, { eventType: "task.answered", reason: "User answered the pending question." });
  }

  // Mirrors observer-task-lifecycle-service.js's abortActiveTask/forceStopTask: stopping
  // only applies to a task that is currently in_progress (matching the original, which
  // throws "task is not currently in progress" for any other status). `force` distinguishes
  // a cooperative stop (the loop notices control.abortRequested on its next iteration and
  // transitions itself) from an immediate one (transition to failed right away, even though
  // the loop may still be mid-flight on a single brain:generate() call it cannot interrupt).
  async function stopTask({ taskId = "", reason = "Stopped by user.", force = false } = {}) {
    const id = String(taskId || "").trim();
    if (!id) throw new Error("taskId is required");
    const task = await getTask(id);
    if (!task) throw new Error(`task ${id} not found`);
    if (task.status !== "in_progress") {
      throw new Error(`task ${id} is not currently in progress`);
    }
    const control = activeControllers.get(id);
    if (control) {
      control.abortRequested = true;
    }
    if (!force) {
      // Cooperative stop: the running loop will notice control.abortRequested on its next
      // iteration and transition the task itself. Return the task as-is for now.
      return task;
    }
    activeControllers.delete(id);
    return transitionTask(id, {
      status: "failed",
      completedAt: nowIso(),
      error: String(reason || "Force-stopped by user.").trim()
    }, { eventType: "task.failed", reason: String(reason || "Force-stopped by user.").trim() });
  }

  // Mirrors observer-queue-processor.js's recoverStaleInProgressTasks, simplified: no
  // specialist-brain fallback routing (dropped per the routing decision above) — a stalled
  // in_progress task (e.g. the process crashed mid-execution) is simply requeued.
  async function recoverStaleInProgressTasks() {
    const inProgress = await listTasks({ status: "in_progress" });
    for (const task of inProgress) {
      if (activeControllers.has(task.id)) continue; // still genuinely running in this process
      const lastTouchedAt = Date.parse(task.updatedAt || task.createdAt || 0) || 0;
      if (!lastTouchedAt || Date.now() - lastTouchedAt < STALE_IN_PROGRESS_MS) continue;
      await transitionTask(task.id, { status: "queued" }, {
        eventType: "task.recovered",
        reason: "Recovered from stale in_progress (no active controller and no recent update)."
      });
      api.broadcast(`[genesis] recovered stale in_progress task ${task.id}`);
    }
  }

  async function dispatchNext() {
    if (dispatching) return;
    dispatching = true;
    try {
      await recoverStaleInProgressTasks();
      const queued = await listTasks({ status: "queued" });
      if (!queued.length) return;
      const next = queued.sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))[0];
      const startedAt = nowIso();
      await transitionTask(next.id, { status: "in_progress", startedAt }, {
        eventType: "task.started",
        reason: "Dispatched from queue."
      });
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
      api.provideCapability("tasks:stop", async (args = {}) => stopTask(args));
      api.provideCapability("tasks:answer", async (args = {}) => answerTask(args));
      api.provideCapability("tasks:history", async ({ taskId } = {}) => (await getTask(taskId))?.history || []);
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
          res.json({
            ok: true,
            task: await stopTask({
              taskId: req.params?.taskId,
              reason: req.body?.reason,
              force: req.body?.force === true
            })
          });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to abort task") });
        }
      });

      app.post("/api/tasks/:taskId/answer", async (req, res) => {
        try {
          res.json({ ok: true, task: await answerTask({ taskId: req.params?.taskId, answer: req.body?.answer }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to answer task") });
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
