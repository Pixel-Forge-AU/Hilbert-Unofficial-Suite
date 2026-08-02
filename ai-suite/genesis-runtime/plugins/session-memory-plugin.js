/**
 * Plugin Name: Session Memory
 * Plugin Slug: session-memory
 * Description: Captures terminal task summaries into Nova prompt memory with optional manual capture APIs.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { compactText } from "../observer-general-utils.js";

function normalizeTaskMemoryKey(task = {}) {
  const id = String(task.id || "").trim();
  const status = String(task.status || "").trim().toLowerCase();
  const stamp = Number(task.completedAt || task.updatedAt || task.startedAt || task.createdAt || 0);
  if (!id) {
    return "";
  }
  return `${id}:${status}:${stamp}`;
}

function buildSessionMemoryEntry(task = {}, run = null) {
  const completedAt = Number(task.completedAt || task.updatedAt || Date.now());
  const at = new Date(completedAt).toISOString();
  const status = String(task.status || "unknown").trim().toLowerCase();
  const codename = String(task.codename || task.id || "").trim();
  const summary = compactText(
    task.resultSummary
    || task.reviewSummary
    || task.workerSummary
    || task.notes
    || task.message
    || "",
    520
  );
  const model = compactText(String(task.model || run?.brain?.model || "").trim(), 120);
  const toolSummary = task?.toolLoopDiagnostics?.summary
    ? compactText(String(task.toolLoopDiagnostics.summary || "").trim(), 320)
    : "";
  const outputFiles = Array.isArray(task.outputFiles)
    ? task.outputFiles.map((file) => String(file?.path || file?.name || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const lines = [
    `## ${at} | ${codename} | ${status}`,
    `- Summary: ${summary || "(no summary reported)"}`,
    model ? `- Model: ${model}` : "",
    outputFiles.length ? `- Output files: ${outputFiles.join(", ")}` : "",
    toolSummary ? `- Tool loop: ${toolSummary}` : "",
    ""
  ].filter(Boolean);
  return `${lines.join("\n")}\n`;
}

function normalizeMemoryState(state = {}) {
  const processed = Array.isArray(state.processed) ? state.processed : [];
  return {
    processed: processed
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .slice(-300),
    updatedAt: Number(state.updatedAt || Date.now()) || Date.now()
  };
}

export function createSessionMemoryPlugin(options = {}) {
  const {
    pluginId = "session-memory",
    pluginName = "Session Memory",
    description = "Adds modular post-task memory extraction into Nova prompt workspace memory files.",
    stateDataKey = "session-memory-state",
    memoryFileName = "SESSION-MEMORY.md"
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
        data: true,
        capabilities: ["appendSessionMemoryFromTask", "getSessionMemoryPluginState"],
        hooks: ["queue:task-processed", "queue:batch-processed"],
        runtimeContext: ["findTaskById", "fs", "path", "promptFilesRoot", "promptStateStore"]
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
      const runtime = api.getRuntimeContext();
      const fs = runtime.fs;
      const path = runtime.path;
      const promptFilesRoot = runtime.promptFilesRoot;
      const promptStateStore = runtime.promptStateStore;
      if (!fs || !path || !promptFilesRoot || !api.data) {
        return;
      }
      const memoryPath = path.join(promptFilesRoot, memoryFileName);

      async function readState() {
        const state = await api.data.readJson(stateDataKey, {});
        return normalizeMemoryState(state);
      }

      async function writeState(nextState = {}) {
        const normalized = normalizeMemoryState(nextState);
        await api.data.writeJson(stateDataKey, normalized);
        return normalized;
      }

      async function appendMemory(task = {}, run = null) {
        const key = normalizeTaskMemoryKey(task);
        if (!key) {
          return { captured: false, reason: "task_missing_key" };
        }
        const status = String(task.status || "").trim().toLowerCase();
        if (!["completed", "failed", "waiting_for_user", "closed"].includes(status)) {
          return { captured: false, reason: "status_not_terminal" };
        }
        const state = await readState();
        if (state.processed.includes(key)) {
          return { captured: false, reason: "already_captured" };
        }
        const stateFs = promptStateStore?.fs || fs;
        await stateFs.mkdir(path.dirname(memoryPath), { recursive: true });
        const entry = buildSessionMemoryEntry(task, run);
        await stateFs.appendFile(memoryPath, entry, "utf8");
        const nextProcessed = [...state.processed, key].slice(-300);
        await writeState({
          ...state,
          processed: nextProcessed,
          updatedAt: Date.now()
        });
        return { captured: true, key, memoryPath };
      }

      api.provideCapability("appendSessionMemoryFromTask", appendMemory);

      api.addHook("queue:task-processed", async (payload = {}) => {
        const task = payload?.task;
        const run = payload?.run || null;
        if (task) {
          await appendMemory(task, run);
        }
        return payload;
      });

      api.addHook("queue:batch-processed", async (payload = {}) => {
        const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
        for (const task of tasks) {
          await appendMemory(task, null);
        }
        return payload;
      });

      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "session-memory-control",
          title: "Session Memory Control",
          description: "Inspect session-memory state and capture a task manually.",
          fields: [
            {
              id: "task_id",
              label: "Task ID",
              type: "text",
              placeholder: "task-123"
            }
          ],
          actions: [
            {
              id: "state",
              label: "Refresh State",
              method: "GET",
              endpoint: "/api/plugins/session-memory/state",
              expects: "json"
            },
            {
              id: "capture",
              label: "Capture Task",
              method: "POST",
              endpoint: "/api/plugins/session-memory/capture",
              bodyFields: ["task_id"],
              expects: "json"
            }
          ]
        });
      }

      api.provideCapability("getSessionMemoryPluginState", async () => {
        const state = await readState();
        return {
          state,
          memoryPath
        };
      });
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugins/session-memory/state", async (req, res) => {
        try {
          const getState = api.getCapability("getSessionMemoryPluginState");
          if (typeof getState !== "function") {
            return res.status(500).json({ ok: false, error: "session memory capability is unavailable" });
          }
          const payload = await getState();
          res.json({ ok: true, ...payload });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read session memory state") });
        }
      });

      app.post("/api/plugins/session-memory/capture", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const taskId = String(req.body?.taskId || req.body?.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const task = await runtime.findTaskById(taskId);
          if (!task) {
            return res.status(404).json({ ok: false, error: "task not found" });
          }
          const appendMemory = api.getCapability("appendSessionMemoryFromTask");
          if (typeof appendMemory !== "function") {
            return res.status(500).json({ ok: false, error: "session memory capability is unavailable" });
          }
          const result = await appendMemory(task, null);
          res.json({ ok: true, result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to capture session memory") });
        }
      });
    }
  };
}
