/**
 * Plugin Name: Task Lifecycle
 * Plugin Slug: task-lifecycle
 * Description: Adds modular task create/stop/wait/output/answer APIs and UI panel metadata for Nova.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { compactText } from "../observer-general-utils.js";

function normalizeTaskSummary(task = {}) {
  return compactText(
    task.resultSummary
    || task.reviewSummary
    || task.workerSummary
    || task.notes
    || task.message
    || "",
    420
  );
}

function normalizeTaskOutputPayload(task = {}, history = []) {
  const status = String(task.status || "").trim();
  const timeline = Array.isArray(history) ? history : [];
  const recentTransitions = timeline.slice(-20).map((entry) => ({
    at: Number(entry.at || 0),
    eventType: String(entry.eventType || "").trim(),
    fromStatus: String(entry.fromStatus || "").trim(),
    toStatus: String(entry.toStatus || "").trim(),
    reason: compactText(entry.reason || "", 260)
  }));
  return {
    taskId: String(task.id || "").trim(),
    codename: String(task.codename || "").trim(),
    status,
    startedAt: Number(task.startedAt || 0) || null,
    completedAt: Number(task.completedAt || task.updatedAt || 0) || null,
    model: String(task.model || "").trim(),
    summary: normalizeTaskSummary(task),
    outputFiles: Array.isArray(task.outputFiles) ? task.outputFiles.map((entry) => ({
      name: String(entry?.name || "").trim(),
      path: String(entry?.path || "").trim(),
      size: Number(entry?.size || 0),
      modifiedAt: Number(entry?.modifiedAt || 0)
    })) : [],
    waitingForUser: status === "waiting_for_user",
    questionCategory: status === "waiting_for_user"
      ? String(task.questionCategory || "").trim()
      : "",
    questionForUser: status === "waiting_for_user"
      ? compactText(task.questionForUser || "", 1200)
      : "",
    transitions: recentTransitions
  };
}

function getTaskLifecycleService(runtime = {}) {
  const service = runtime?.taskLifecycleService;
  return service && typeof service === "object" ? service : null;
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
      return {
        ok: false,
        done: false,
        status: "missing",
        task: null,
        elapsedMs: Date.now() - start
      };
    }
    const status = String(task.status || "").trim().toLowerCase();
    if (["completed", "failed", "closed", "waiting_for_user"].includes(status)) {
      return {
        ok: true,
        done: true,
        status,
        task,
        elapsedMs: Date.now() - start
      };
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
    description = "Adds modular task create/stop/output/wait lifecycle APIs for Nova."
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
        runtimeContext: [
          "taskLifecycleService"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
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
          const service = getTaskLifecycleService(api.getRuntimeContext());
          if (!service || typeof service.findTaskById !== "function" || typeof service.readTaskHistory !== "function") {
            return res.status(503).json({ ok: false, error: "task lifecycle runtime context is unavailable" });
          }
          const taskId = String(req.query.taskId || req.query.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const task = await service.findTaskById(taskId);
          if (!task) {
            return res.status(404).json({ ok: false, error: "task not found" });
          }
          const historyLimit = Math.max(5, Math.min(Number(req.query.historyLimit || 40), 200));
          const history = await service.readTaskHistory(taskId, { limit: historyLimit });
          res.json({
            ok: true,
            output: normalizeTaskOutputPayload(task, history)
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to fetch task output") });
        }
      });

      app.post("/api/plugins/tasks/stop", async (req, res) => {
        try {
          const service = getTaskLifecycleService(api.getRuntimeContext());
          if (!service || typeof service.stopTask !== "function") {
            return res.status(503).json({ ok: false, error: "task lifecycle runtime context is unavailable" });
          }
          const taskId = String(req.body?.taskId || req.body?.task_id || "").trim();
          const reason = String(req.body?.reason || "Stopped by plugin lifecycle endpoint.").trim();
          const force = req.body?.force === true || String(req.body?.force || "").trim().toLowerCase() === "true";
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const task = await service.stopTask({ taskId, reason, force });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to stop task") });
        }
      });

      app.post("/api/plugins/tasks/answer", async (req, res) => {
        try {
          const service = getTaskLifecycleService(api.getRuntimeContext());
          if (!service || typeof service.answerTask !== "function") {
            return res.status(503).json({ ok: false, error: "task lifecycle runtime context is unavailable" });
          }
          const taskId = String(req.body?.taskId || req.body?.task_id || "").trim();
          const answer = String(req.body?.answer || "").trim();
          const sessionId = String(req.body?.sessionId || req.body?.session_id || "Main").trim() || "Main";
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          if (!answer) {
            return res.status(400).json({ ok: false, error: "answer is required" });
          }
          const task = await service.answerTask({ taskId, answer, sessionId });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to answer waiting task") });
        }
      });

      app.post("/api/plugins/tasks/create", async (req, res) => {
        try {
          const service = getTaskLifecycleService(api.getRuntimeContext());
          if (!service || typeof service.createTask !== "function") {
            return res.status(503).json({ ok: false, error: "task lifecycle runtime context is unavailable" });
          }
          const task = await service.createTask({
            message: String(req.body?.message || "").trim(),
            sessionId: String(req.body?.sessionId || "Main").trim() || "Main",
            requestedBrainId: String(req.body?.requestedBrainId || "worker").trim() || "worker",
            intakeBrainId: String(req.body?.intakeBrainId || "bitnet").trim() || "bitnet",
            internetEnabled: req.body?.internetEnabled == null ? true : Boolean(req.body?.internetEnabled),
            selectedMountIds: Array.isArray(req.body?.selectedMountIds) ? req.body.selectedMountIds : [],
            forceToolUse: req.body?.forceToolUse === true,
            requireWorkerPreflight: req.body?.requireWorkerPreflight === true,
            attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
            notes: String(req.body?.notes || "Task created via task lifecycle plugin.").trim(),
            taskMeta: req.body?.taskMeta && typeof req.body.taskMeta === "object" ? req.body.taskMeta : {}
          });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to create task") });
        }
      });

      app.get("/api/plugins/tasks/wait", async (req, res) => {
        try {
          const service = getTaskLifecycleService(api.getRuntimeContext());
          if (!service || typeof service.findTaskById !== "function" || typeof service.readTaskHistory !== "function") {
            return res.status(503).json({ ok: false, error: "task lifecycle runtime context is unavailable" });
          }
          const taskId = String(req.query.taskId || req.query.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const timeoutMsValue = req.query.timeoutMs ?? req.query.timeout_ms ?? 30000;
          const pollMsValue = req.query.pollMs ?? req.query.poll_ms ?? 800;
          const waitResult = await waitForTaskTerminalState({
            findTaskById: service.findTaskById,
            taskId,
            timeoutMs: Number(timeoutMsValue),
            pollMs: Number(pollMsValue)
          });
          if (!waitResult.task) {
            return res.status(404).json(waitResult);
          }
          const history = await service.readTaskHistory(taskId, { limit: 40 });
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
