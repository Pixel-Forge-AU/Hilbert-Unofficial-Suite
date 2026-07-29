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
//   - a three-way intake/triage split (reply / clarify / queue), with session history,
//     multi-task queueing, and explicit-only schedule detection (see
//     intake-planner-service.js / intake-routing-domain.js / session-conversation-store.js
//     / observer-request-heuristics.js for the pattern — ported in a later pass)
//   - simple interval-based cron scheduling that enqueues tasks (see cron-domain.js)
//   - a bounded automatic retry on task failure (see observer-queue-processor.js's
//     chooseAutomaticRetryBrainId retry-gate pattern, minus the specialist-brain selection)
//   - an opt-in, off-by-default idle opportunity scan (see observer-opportunity-domain.js's
//     processQueuedTasksToCapacity-adjacent idle-scan trigger, minus its workspace-markdown-
//     file-ranking implementation, which is Nova-workspace-mount-specific)
//
// EXPLICITLY NOT PORTED (deferred, not silently dropped — each is Nova personal-assistant
// *product* behavior tied to concepts Genesis has no equivalent for):
// - escalation-review (observer-escalation-review.js): retries a failed task on a distinct
//   "remote triage" brain. Meaningless without brain-kind/specialist routing, which this
//   extraction deliberately drops (see the routing decision above).
// - helper-scout / maintenance-support / the "recreation" reflective job
//   (observer-maintenance-support.js, observer-recreation-job.js): periodic self-maintenance
//   and personality-regeneration jobs specific to Nova's own persona system.
// - the elaborate failure-classification taxonomy and capability-mismatch retry-message
//   builder (observer-failure-domain.js): classifies failure signal strings
//   ("no_inspection", "speculative_completion", "project-cycle finalization", harness-eval
//   snapshots) that only the full observer-execution-runner.js tool loop — not this
//   plugin's deliberately simpler one — ever produces. Porting the classifier without the
//   thing it classifies would be dead code.
// - Nova's elaborate native chat-response builders (calendar/finance/inbox summaries —
//   those depend on domains like calendar/finance that were never part of Nova's
//   *infrastructure* either) and tool-loop-repair-helpers' sandbox-specific JSON-repair
//   heuristics.
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
const MAX_TASK_RETRIES = 2;
const DEFAULT_OPPORTUNITY_SCAN_INTERVAL_MS = 30 * 60 * 1000;

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

// --- Intake heuristics, ported from observer-request-heuristics.js (the generic,
// Nova-agnostic subset only — the many isXSummaryRequest() domain classifiers there are
// native chat-response routing for calendar/finance/mail, which is explicitly out of scope
// per this file's header). ---

function normalizeSummaryComparisonText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A model-proposed task message is "low signal" if it's too short or just echoes the
// original request verbatim — in that case, reshape it into something more concrete.
function looksLikeLowSignalPlannerTaskMessage(taskMessage = "", prompt = "") {
  const normalizedTask = normalizeSummaryComparisonText(taskMessage);
  const normalizedPrompt = normalizeSummaryComparisonText(prompt);
  if (!normalizedTask || normalizedTask.length < 24) return true;
  return normalizedTask === normalizedPrompt;
}

function shapePlannerTaskMessage(message = "") {
  const raw = String(message || "").trim();
  if (!raw) return "";
  const readAndWriteMatch = raw.match(/^read\s+(.+?)\s+and\s+write\s+(.+)$/i);
  if (readAndWriteMatch) {
    const source = String(readAndWriteMatch[1] || "").trim();
    const outcome = String(readAndWriteMatch[2] || "").trim().replace(/\.$/, "");
    return `Inspect ${source}. Produce ${outcome}. Base the result on concrete content from the source instead of generic assumptions.`;
  }
  const compareMatch = raw.match(/^compare\s+(.+?)\s+and\s+create\s+(.+)$/i);
  if (compareMatch) {
    const leftRight = String(compareMatch[1] || "").trim();
    const outcome = String(compareMatch[2] || "").trim().replace(/\.$/, "");
    return `Compare ${leftRight}. Identify the key overlap and differences, then create ${outcome} as a concrete deliverable.`;
  }
  return `${raw} Produce a concrete outcome, not just a status note.`;
}

// A message asking for phrasing/wording help should get a direct reply even if it also
// contains task-shaped language — never silently queue "help me phrase this" as work.
function isLightweightPlannerReplyRequest(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (/\bevery\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text) || /\bin\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text)) return false;
  if (/\b(read|inspect|open|search|write to|create file|run|test|debug|fix|implement|refactor|code)\b/.test(text)) return false;
  return /\b(help me phrase|phrase a|better titles?|how should i structure|good next step|what should i say|rewrite this sentence|word this)\b/.test(text);
}

// Only trust an explicit "every N units" / scheduling keyword in the user's own words —
// never let the model hallucinate a recurring schedule the user didn't ask for.
function intakeMessageExplicitlyRequestsScheduling(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (/\b(?:every|in)\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text)) return true;
  return /\b(schedule|scheduled|cron|recurring|repeat|repeating|periodic|daily|weekly|monthly|hourly|nightly|background job|remind me)\b/.test(text);
}

function parseEveryToMs(every = "") {
  const match = String(every || "").trim().toLowerCase().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return Math.max(0, amount * unitMs);
}

// Mirrors intake-routing-domain.js's buildQueuedIntakeReceipt.
function buildQueuedIntakeReceipt(tasks = [], fallbackText = "") {
  if (!tasks.length) return String(fallbackText || "I'll take a closer look now.").trim();
  const receipt = tasks.length === 1
    ? `I've queued task ${tasks[0].id} for the worker. You can follow it in the task queue.`
    : `I've queued ${tasks.length} tasks for the worker: ${tasks.map((t) => t.id).join(", ")}. You can follow them in the task queue.`;
  const base = String(fallbackText || "").trim();
  return base && !/^i'?ll take a closer look now\.?$/i.test(base) ? `${base}\n\n${receipt}` : receipt;
}

// Mirrors session-conversation-store.js: a small in-memory per-session window with
// expiry and older-turns summarization, used so the intake planner can see recent
// conversation context (follow-up detection) without persisting full transcripts to disk.
function createSessionConversationStore({ maxExchanges = 10, expireMs = 2 * 60 * 60 * 1000, recentWindow = 8 } = {}) {
  const store = new Map();

  function getSessionHistory(sessionId = "Main") {
    const key = String(sessionId || "Main").trim() || "Main";
    const entry = store.get(key);
    if (!entry) return [];
    if (Date.now() - Number(entry.lastAt || 0) > expireMs) {
      store.delete(key);
      return [];
    }
    const exchanges = entry.exchanges.slice();
    if (exchanges.length <= recentWindow) return exchanges;
    const older = exchanges.slice(0, exchanges.length - recentWindow);
    const recent = exchanges.slice(exchanges.length - recentWindow);
    const userSnippets = older.filter((turn) => turn.role === "user").map((turn) => `"${String(turn.text || "").slice(0, 80)}"`);
    if (!userSnippets.length) return recent;
    return [{ role: "agent", text: `[Earlier in this session: ${userSnippets.join("; ")}]`, ts: older[0]?.ts || Date.now() }, ...recent];
  }

  function appendSessionExchange(sessionId = "Main", { userText = "", agentText = "", action = "" } = {}) {
    const key = String(sessionId || "Main").trim() || "Main";
    const user = String(userText || "").trim();
    const agent = String(agentText || "").trim();
    if (!user && !agent) return;
    const entry = store.get(key) || { exchanges: [], lastAt: 0 };
    const ts = Date.now();
    if (user) entry.exchanges.push({ role: "user", text: user, ts });
    if (agent) entry.exchanges.push({ role: "agent", text: agent, ts, ...(action ? { action } : {}) });
    while (entry.exchanges.length > maxExchanges * 2) entry.exchanges.shift();
    entry.lastAt = ts;
    store.set(key, entry);
  }

  return { getSessionHistory, appendSessionExchange };
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
  const sessionConversationStore = createSessionConversationStore();

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
    await api.runHook("task:created", { task }).catch(() => {});
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

  // Mirrors observer-queue-processor.js's retry gate (chooseAutomaticRetryBrainId +
  // canReshapeTask), simplified: no specialist-brain fallback selection is built in here —
  // but unlike the earlier version of this function, that's no longer a permanent
  // limitation. Before giving up for good, this fires "task:retry-exhausted" so a plugin
  // that wants Nova's dropped escalation-review/specialist-fallback behavior (or anything
  // else) can listen via api.addHook and take over: returning `{ ...payload, handled: true }`
  // (optionally with a `redirectTo` capability name/brainId/message to act on) skips this
  // function's own default failure, leaving the task exactly as the handler left it. This
  // is the "minimalist core, hooks for everything" pattern applied to the retry decision.
  async function failTaskOrRetry(task, { error = "", transcript = [] } = {}) {
    const retryCount = Number(task.retryCount || 0);
    if (retryCount < MAX_TASK_RETRIES) {
      const retried = await transitionTask(task.id, {
        status: "queued",
        retryCount: retryCount + 1,
        error: String(error || "").trim(),
        transcript
      }, {
        eventType: "task.retried",
        reason: `Retrying (attempt ${retryCount + 1}/${MAX_TASK_RETRIES}) after: ${String(error || "").trim()}`
      });
      await api.runHook("task:retried", { task: retried, error }).catch(() => {});
      return retried;
    }
    const hookResult = await api.runHook("task:retry-exhausted", { task, error, transcript, handled: false }).catch(() => null);
    if (hookResult?.handled === true) {
      return getTask(task.id);
    }
    const failed = await transitionTask(task.id, {
      status: "failed",
      completedAt: nowIso(),
      error: String(error || "").trim(),
      transcript
    }, {
      eventType: "task.failed",
      reason: `Failed permanently after ${MAX_TASK_RETRIES} retries: ${String(error || "").trim()}`
    });
    await api.runHook("task:failed", { task: failed, error }).catch(() => {});
    return failed;
  }

  async function executeTask(task) {
    const generate = api.getCapability("brain:generate");
    if (typeof generate !== "function") {
      await failTaskOrRetry(task, { error: 'no "brain:generate" capability is available — install a model-provider plugin' });
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
          const aborted = await transitionTask(task.id, {
            status: "failed",
            completedAt: nowIso(),
            error: "aborted by user",
            transcript
          }, { eventType: "task.failed", reason: "Aborted by user." });
          await api.runHook("task:failed", { task: aborted, error: "aborted by user" }).catch(() => {});
          return;
        }
        let response;
        try {
          response = await generate({
            brainId: task.brainId || undefined,
            messages: transcript.map(({ role, content }) => ({ role, content }))
          });
        } catch (err) {
          await failTaskOrRetry(task, { error: String(err?.message || err || "generation failed"), transcript });
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
        const waitingTask = await transitionTask(task.id, {
          status: "waiting",
          waitingForUser: true,
          questionForUser: waiting.question,
          transcript
        }, { eventType: "task.waiting", reason: waiting.question });
        api.broadcast(`[genesis] task ${task.id} waiting for user input`);
        await api.runHook("task:waiting", { task: waitingTask }).catch(() => {});
        return;
      }

      if (!finalText) {
        await failTaskOrRetry(task, { error: "tool loop exhausted without a final answer", transcript });
        api.broadcast(`[genesis] task ${task.id} failed or requeued for retry`);
        return;
      }
      const completed = await transitionTask(task.id, {
        status: "done",
        completedAt: nowIso(),
        result: { text: finalText },
        error: "",
        transcript
      }, { eventType: "task.completed", reason: "Task completed." });
      api.broadcast(`[genesis] task ${task.id} completed`);
      await api.runHook("task:completed", { task: completed }).catch(() => {});
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

  // --- Idle opportunity scan (opt-in, off by default) ----------------------
  //
  // Mirrors observer-opportunity-domain.js's shape (when the queue has been idle for a
  // while, use the spare cycles to look for something useful to do) without its
  // implementation (ranking workspace markdown files by heuristic score against a
  // Docker-mounted workspace root — a concept specific to Nova's sandbox/workspace mounts
  // that doesn't exist at this layer in Genesis). Off by default because autonomously
  // creating tasks is a meaningful behavior change a user should opt into, not something
  // that starts happening silently after an upgrade.
  async function getSettings() {
    return (await api.data.readJson("settings", { opportunityScanEnabled: false, opportunityScanIntervalMs: DEFAULT_OPPORTUNITY_SCAN_INTERVAL_MS, lastOpportunityScanAt: 0 }))
      || { opportunityScanEnabled: false, opportunityScanIntervalMs: DEFAULT_OPPORTUNITY_SCAN_INTERVAL_MS, lastOpportunityScanAt: 0 };
  }

  async function updateSettings(patch = {}) {
    const settings = { ...(await getSettings()), ...patch };
    await api.data.writeJson("settings", settings);
    return settings;
  }

  async function maybeRunOpportunityScan() {
    const settings = await getSettings();
    if (!settings.opportunityScanEnabled) return;
    const intervalMs = Math.max(60000, Number(settings.opportunityScanIntervalMs || DEFAULT_OPPORTUNITY_SCAN_INTERVAL_MS));
    if (Date.now() - Number(settings.lastOpportunityScanAt || 0) < intervalMs) return;
    await updateSettings({ lastOpportunityScanAt: Date.now() });
    const task = await createTask({
      request: "Idle opportunity scan: check if there is anything useful to look into or improve right now using the tools available to you. If nothing concrete comes to mind, say so briefly — do not invent busywork."
    });
    await transitionTask(task.id, { internalJobType: "opportunity_scan" }, { eventType: "task.updated", reason: "Tagged as an idle opportunity scan." });
    api.broadcast(`[genesis] queued idle opportunity scan as ${task.id}`);
  }

  async function dispatchNext() {
    if (dispatching) return;
    dispatching = true;
    try {
      await recoverStaleInProgressTasks();
      const queued = await listTasks({ status: "queued" });
      if (!queued.length) {
        // "queue:idle" is the extension point for anything that wants to use spare
        // capacity — this plugin's own opportunity scan is just the default listener.
        // A plugin can pre-empt it entirely by returning `{ handled: true }` (e.g. a
        // future maintenance/escalation-review/recreation plugin deciding what idle time
        // should be spent on, instead of that decision being hardcoded here).
        const hookResult = await api.runHook("queue:idle", { handled: false }).catch(() => null);
        if (hookResult?.handled !== true) {
          await maybeRunOpportunityScan();
        }
        return;
      }
      const next = queued.sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))[0];
      const startedAt = nowIso();
      const started = await transitionTask(next.id, { status: "in_progress", startedAt }, {
        eventType: "task.started",
        reason: "Dispatched from queue."
      });
      await api.runHook("task:started", { task: started }).catch(() => {});
      const task = await getTask(next.id);
      await executeTask(task);
    } catch (err) {
      api.broadcast(`[genesis] dispatch error: ${String(err?.message || err)}`);
    } finally {
      dispatching = false;
    }
  }

  // --- Intake / triage --------------------------------------------------
  //
  // Ported from intake-planner-service.js / intake-routing-domain.js (adapted, not a
  // mechanical copy): a three-way triage split (reply directly / ask a clarifying question
  // / queue background work), with recent session history for follow-up context, multiple
  // tasks per message, and "every N" recurring-schedule detection feeding the cron
  // mechanism below. Nova's "bitnet" dedicated intake-brain concept and its tool-calling
  // planner loop (which let the intake model itself call tools while deciding) are dropped
  // per the routing decision documented at the top of this file — this uses whatever
  // brain:generate-json capability is installed, same as everything else here.
  async function handleIntakeMessage({ text = "", sessionId = "Main" } = {}) {
    const message = String(text || "").trim();
    if (!message) throw new Error("text is required");
    const session = String(sessionId || "Main").trim() || "Main";
    const generateJson = api.getCapability("brain:generate-json") || api.getCapability("brain:generate");

    const recordAndReturn = (result) => {
      sessionConversationStore.appendSessionExchange(session, {
        userText: message,
        agentText: result.replyText || "",
        action: result.action
      });
      return result;
    };

    if (typeof generateJson !== "function") {
      // No model provider installed — fall back to always queueing.
      const task = await createTask({ request: message });
      return recordAndReturn({ action: "queue", tasks: [task], replyText: buildQueuedIntakeReceipt([task], "") });
    }

    const history = sessionConversationStore.getSessionHistory(session);
    const historyText = history.length
      ? `\n\nRecent conversation:\n${history.map((turn) => `${turn.role}: ${turn.text}`).join("\n")}`
      : "";
    const systemPrompt = [
      "Decide how to triage this message. Respond with JSON only, one of:",
      '{"action":"reply","replyText":"..."} to answer directly in one short reply,',
      '{"action":"clarify","replyText":"..."} to ask a clarifying question before doing anything,',
      'or {"action":"queue","tasks":[{"message":"...","every":""}]} to queue one or more',
      'background tasks (set "every" to a duration like "1h"/"30m" only if the user',
      "explicitly asked for a recurring/scheduled job)."
    ].join(" ");

    let decision;
    try {
      const raw = await generateJson({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${message}${historyText}` }
        ]
      });
      const responseText = typeof raw === "string" ? raw : String(raw?.text || raw?.content || "{}");
      decision = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {
      decision = { action: "queue" };
    }

    let action = decision?.action === "reply" ? "reply" : decision?.action === "clarify" ? "clarify" : "queue";
    const replyText = String(decision?.replyText || "").trim();

    if (action === "queue" && isLightweightPlannerReplyRequest(message)) {
      action = "reply";
    }
    if ((action === "reply" || action === "clarify") && replyText) {
      return recordAndReturn({ action, replyText });
    }

    // action === "queue" (or a "reply"/"clarify" the model returned with no replyText —
    // treat as a queue fallback rather than silently returning nothing).
    const explicitlyScheduled = intakeMessageExplicitlyRequestsScheduling(message);
    const requestedTasks = Array.isArray(decision?.tasks) && decision.tasks.length
      ? decision.tasks
      : [{ message, every: "" }];

    const createdTasks = [];
    for (const requested of requestedTasks) {
      let taskMessage = String(requested?.message || "").trim() || message;
      if (looksLikeLowSignalPlannerTaskMessage(taskMessage, message)) {
        taskMessage = shapePlannerTaskMessage(message);
      }
      const every = explicitlyScheduled ? String(requested?.every || "").trim() : "";
      if (every && parseEveryToMs(every) > 0) {
        const job = await addCronJob({ directive: taskMessage, intervalMs: parseEveryToMs(every) });
        createdTasks.push({ id: job.id, scheduled: true, every });
      } else {
        createdTasks.push(await createTask({ request: taskMessage }));
      }
    }
    return recordAndReturn({
      action: "queue",
      tasks: createdTasks,
      replyText: buildQueuedIntakeReceipt(createdTasks, replyText)
    });
  }

  // --- Cron ---------------------------------------------------------------

  async function loadCronJobs() {
    return (await api.data.readJson("cron-jobs", { jobs: [] })) || { jobs: [] };
  }

  async function addCronJob({ directive = "", intervalMs = 3600000, brainId = "" } = {}) {
    const state = await loadCronJobs();
    const job = {
      id: `cron-${Date.now().toString(36)}`,
      directive: String(directive || "").trim(),
      intervalMs: Math.max(60000, Number(intervalMs || 3600000)),
      brainId: String(brainId || "").trim(),
      lastRunAt: 0,
      nextRunAt: Date.now()
    };
    if (!job.directive) throw new Error("directive is required");
    state.jobs.push(job);
    await api.data.writeJson("cron-jobs", state);
    return job;
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
          res.json({ ok: true, job: await addCronJob(req.body || {}) });
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

      app.get("/api/agent/settings", async (_req, res) => {
        res.json({ ok: true, settings: await getSettings() });
      });

      app.post("/api/agent/settings", async (req, res) => {
        try {
          const patch = {};
          if (req.body?.opportunityScanEnabled != null) patch.opportunityScanEnabled = Boolean(req.body.opportunityScanEnabled);
          if (req.body?.opportunityScanIntervalMs != null) patch.opportunityScanIntervalMs = Math.max(60000, Number(req.body.opportunityScanIntervalMs));
          res.json({ ok: true, settings: await updateSettings(patch) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to update settings") });
        }
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
