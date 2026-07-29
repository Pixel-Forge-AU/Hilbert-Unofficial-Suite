// Ported from genesis-core's server/plugins/task-lifecycle-plugin.js, which shipped
// byte-identical into this repo but relied on Nova's server.js injecting a
// `taskLifecycleService` via the (Nova-era) runtimeContext mechanism. Nothing in Genesis's
// server.js ever populates runtimeContext (it's `{}` — see server.js), so every route here
// silently 503'd ("task lifecycle runtime context is unavailable") no matter what.
//
// Fixed the same way developer-tools-plugin.js was already fixed for its own
// runtimeContext dependency: delegate to capabilities instead. agent-runtime-plugin.js now
// owns the real task queue/storage/execution mechanism (see its header for what was ported
// from observer-task-storage.js / observer-task-lifecycle-service.js /
// observer-queue-processor.js) and exposes it as tasks:create/get/list/stop/answer/history
// capabilities. This plugin is the thin Nova-shaped HTTP surface on top of those
// capabilities — same route paths and field names as the original
// (/api/plugins/tasks/create|output|wait|stop|answer), adapted to the simpler task shape
// Genesis's agent-runtime-plugin.js actually produces (no brain-kind routing, no
// sessionId/attachments/specialistRoute — those were dropped in agent-runtime-plugin.js
// per the same routing decision documented there).

import { compactText } from "../observer-general-utils.js";

function normalizeTaskOutputPayload(task = {}, history = []) {
  const status = String(task.status || "").trim();
  const timeline = Array.isArray(history) ? history : [];
  const recentTransitions = timeline.slice(-20).map((entry) => ({
    at: Date.parse(entry.at || 0) || 0,
    eventType: String(entry.eventType || "").trim(),
    fromStatus: String(entry.fromStatus || "").trim(),
    toStatus: String(entry.toStatus || "").trim(),
    reason: compactText(entry.reason || "", 260)
  }));
  return {
    taskId: String(task.id || "").trim(),
    status,
    startedAt: Date.parse(task.startedAt || 0) || null,
    completedAt: Date.parse(task.completedAt || task.updatedAt || 0) || null,
    model: String(task.brainId || "").trim(),
    summary: compactText(task.result?.text || task.error || "", 420),
    waitingForUser: status === "waiting",
    questionForUser: status === "waiting" ? compactText(task.questionForUser || "", 1200) : "",
    transitions: recentTransitions
  };
}

async function waitForTaskTerminalState({
  findTaskById,
  taskId,
  timeoutMs = 30000,
  pollMs = 800
} = {}) {
  const start = Date.now();
  const maxWaitMs = Math.max(1000, Math.min(Number(timeoutMs || 30000), 10 * 60 * 1000));
  const intervalMs = Math.max(100, Math.min(Number(pollMs || 800), 5000));
  while (Date.now() - start <= maxWaitMs) {
    const task = await findTaskById(taskId);
    if (!task) {
      return { ok: false, done: false, status: "missing", task: null, elapsedMs: Date.now() - start };
    }
    const status = String(task.status || "").trim().toLowerCase();
    if (["done", "failed", "waiting"].includes(status)) {
      return { ok: true, done: true, status, task, elapsedMs: Date.now() - start };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const task = await findTaskById(taskId);
  return {
    ok: true,
    done: false,
    status: String(task?.status || "unknown").trim().toLowerCase(),
    task,
    elapsedMs: Date.now() - start
  };
}

export function createTaskLifecyclePlugin(options = {}) {
  const {
    pluginId = "task-lifecycle",
    pluginName = "Task Lifecycle",
    description = "Adds modular task create/stop/output/wait lifecycle APIs for Genesis's agent runtime."
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: false,
        capabilities: [],
        hooks: [],
        runtimeContext: []
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["tasks:create", "tasks:get", "tasks:stop", "tasks:answer", "tasks:history"]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "task-lifecycle-control",
          title: "Task Lifecycle Control",
          description: "Create tasks and manage waiting/in-progress tasks.",
          fields: [
            {
              id: "task_id",
              label: "Task ID",
              type: "text",
              placeholder: "task-123"
            },
            {
              id: "message",
              label: "Task Message",
              type: "textarea",
              placeholder: "Investigate queue backlog and summarize findings."
            },
            {
              id: "answer",
              label: "Answer",
              type: "text",
              placeholder: "approve"
            },
            {
              id: "timeout_ms",
              label: "Wait Timeout (ms)",
              type: "number",
              min: 1000,
              max: 600000,
              step: 1000,
              defaultValue: 30000
            },
            {
              id: "force",
              label: "Force Stop",
              type: "checkbox",
              defaultValue: false
            }
          ],
          actions: [
            {
              id: "create",
              label: "Create",
              method: "POST",
              endpoint: "/api/plugins/tasks/create",
              bodyFields: ["message"],
              expects: "json"
            },
            {
              id: "output",
              label: "Output",
              method: "GET",
              endpoint: "/api/plugins/tasks/output",
              queryFields: ["task_id"],
              expects: "json"
            },
            {
              id: "wait",
              label: "Wait",
              method: "GET",
              endpoint: "/api/plugins/tasks/wait",
              queryFields: ["task_id", "timeout_ms"],
              expects: "json"
            },
            {
              id: "stop",
              label: "Stop",
              method: "POST",
              endpoint: "/api/plugins/tasks/stop",
              bodyFields: ["task_id", "force"],
              expects: "json"
            },
            {
              id: "answer",
              label: "Answer",
              method: "POST",
              endpoint: "/api/plugins/tasks/answer",
              bodyFields: ["task_id", "answer"],
              expects: "json"
            }
          ]
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugins/tasks/output", async (req, res) => {
        try {
          const findTaskById = api.getCapability("tasks:get");
          const readHistory = api.getCapability("tasks:history");
          if (typeof findTaskById !== "function") {
            return res.status(503).json({ ok: false, error: "no plugin provides the tasks:get capability (install agent-runtime)" });
          }
          const taskId = String(req.query.taskId || req.query.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const task = await findTaskById({ taskId });
          if (!task) {
            return res.status(404).json({ ok: false, error: "task not found" });
          }
          const history = typeof readHistory === "function" ? await readHistory({ taskId }) : [];
          res.json({ ok: true, output: normalizeTaskOutputPayload(task, history) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to fetch task output") });
        }
      });

      app.post("/api/plugins/tasks/stop", async (req, res) => {
        try {
          const stopTask = api.getCapability("tasks:stop");
          if (typeof stopTask !== "function") {
            return res.status(503).json({ ok: false, error: "no plugin provides the tasks:stop capability (install agent-runtime)" });
          }
          const taskId = String(req.body?.taskId || req.body?.task_id || "").trim();
          const reason = String(req.body?.reason || "Stopped by plugin lifecycle endpoint.").trim();
          const force = req.body?.force === true || String(req.body?.force || "").trim().toLowerCase() === "true";
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const task = await stopTask({ taskId, reason, force });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to stop task") });
        }
      });

      app.post("/api/plugins/tasks/answer", async (req, res) => {
        try {
          const answerTask = api.getCapability("tasks:answer");
          if (typeof answerTask !== "function") {
            return res.status(503).json({ ok: false, error: "no plugin provides the tasks:answer capability (install agent-runtime)" });
          }
          const taskId = String(req.body?.taskId || req.body?.task_id || "").trim();
          const answer = String(req.body?.answer || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          if (!answer) {
            return res.status(400).json({ ok: false, error: "answer is required" });
          }
          const task = await answerTask({ taskId, answer });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to answer waiting task") });
        }
      });

      app.post("/api/plugins/tasks/create", async (req, res) => {
        try {
          const createTask = api.getCapability("tasks:create");
          if (typeof createTask !== "function") {
            return res.status(503).json({ ok: false, error: "no plugin provides the tasks:create capability (install agent-runtime)" });
          }
          const task = await createTask({
            request: String(req.body?.message || req.body?.request || "").trim(),
            brainId: String(req.body?.brainId || req.body?.requestedBrainId || "").trim()
          });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to create task") });
        }
      });

      app.get("/api/plugins/tasks/wait", async (req, res) => {
        try {
          const findTaskByIdCap = api.getCapability("tasks:get");
          const readHistory = api.getCapability("tasks:history");
          if (typeof findTaskByIdCap !== "function") {
            return res.status(503).json({ ok: false, error: "no plugin provides the tasks:get capability (install agent-runtime)" });
          }
          const taskId = String(req.query.taskId || req.query.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const timeoutMsValue = req.query.timeoutMs ?? req.query.timeout_ms ?? 30000;
          const pollMsValue = req.query.pollMs ?? req.query.poll_ms ?? 800;
          const waitResult = await waitForTaskTerminalState({
            findTaskById: (id) => findTaskByIdCap({ taskId: id }),
            taskId,
            timeoutMs: Number(timeoutMsValue),
            pollMs: Number(pollMsValue)
          });
          if (!waitResult.task) {
            return res.status(404).json(waitResult);
          }
          const history = typeof readHistory === "function" ? await readHistory({ taskId }) : [];
          res.json({
            ...waitResult,
            output: normalizeTaskOutputPayload(waitResult.task, history)
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to wait for task") });
        }
      });
    }
  };
}
