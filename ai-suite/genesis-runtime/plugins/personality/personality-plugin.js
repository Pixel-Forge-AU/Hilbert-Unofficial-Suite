/**
 * Plugin Name: Personality
 * Plugin Slug: personality
 * Description: Owns the Nova Environment, Props, and Recreation subtabs.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireRuntimeFn(runtime = {}, name = "") {
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

async function buildRecreationStatusPayload(api, limitInput = 10) {
  const runtime = api.getRuntimeContext();
  const listAllTasks = requireRuntimeFn(runtime, "listAllTasks");
  const listTasksByFolder = requireRuntimeFn(runtime, "listTasksByFolder");
  const queueClosed = String(runtime?.TASK_QUEUE_CLOSED || "").trim();
  if (!listAllTasks || !listTasksByFolder || !queueClosed) {
    throw new Error("personality runtime context is unavailable");
  }

  const limit = Math.min(20, Math.max(1, Number(limitInput || 10) || 10));
  const { queued, inProgress, done } = await listAllTasks();
  const closed = await listTasksByFolder(queueClosed, "closed");
  const isRecreation = (task) => String(task?.internalJobType || "").trim() === "agent_recreation";

  const scheduledTask = queued.find(isRecreation) || null;
  const runningTask = inProgress.find(isRecreation) || null;
  const recentTasks = [...done, ...closed]
    .filter(isRecreation)
    .sort((left, right) =>
      Number(right.completedAt || right.updatedAt || right.createdAt || 0)
      - Number(left.completedAt || left.updatedAt || left.createdAt || 0)
    )
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      codename: task.codename,
      status: task.status,
      startedAt: task.startedAt || null,
      completedAt: task.completedAt || task.updatedAt || null,
      summary: String(task.workerSummary || task.resultSummary || task.reviewSummary || task.notes || "").trim(),
      brain: task.requestedBrainId || null,
      internetEnabled: task.internetEnabled === true
    }));

  return {
    scheduled: scheduledTask
      ? {
          id: scheduledTask.id,
          notBeforeAt: scheduledTask.notBeforeAt || null,
          notes: scheduledTask.notes || ""
        }
      : null,
    running: runningTask
      ? {
          id: runningTask.id,
          codename: runningTask.codename,
          startedAt: runningTask.startedAt || null,
          brain: runningTask.requestedBrainId || null
        }
      : null,
    recent: recentTasks
  };
}

export function createPersonalityPlugin(options = {}) {
  const {
    pluginId = "personality",
    pluginName = "Personality",
    description = "Nova Environment, Props, and Recreation plugin."
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
        capabilities: [
          "subsystem:classify"
        ],
        hooks: [],
        runtimeContext: [
          "TASK_QUEUE_CLOSED",
          "ensureRecreationJob",
          "listAllTasks",
          "listTasksByFolder",
          "noteInteractiveActivity"
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
      if (typeof api.provideCapability === "function") {
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/personality/") || pathname.startsWith("/api/plugin-ui/personality/")) {
            next.add("personality");
            next.add("avatar");
          }
          return [...next];
        });
      }
      if (typeof api.registerUiNovaTab === "function") {
        api.registerUiNovaTab({
          id: "behavior",
          title: "Behavior",
          order: 39,
          scriptUrl: "/api/plugin-ui/personality/nova-tab.js"
        });
        api.registerUiNovaTab({
          id: "environment",
          title: "Environment",
          order: 40,
          scriptUrl: "/api/plugin-ui/personality/nova-tab.js"
        });
        api.registerUiNovaTab({
          id: "props",
          title: "Props",
          order: 41,
          scriptUrl: "/api/plugin-ui/personality/nova-tab.js"
        });
        api.registerUiNovaTab({
          id: "recreation",
          title: "Recreation",
          order: 42,
          scriptUrl: "/api/plugin-ui/personality/nova-tab.js"
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/personality/nova-tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "personality-nova-tab.js"));
      });

      app.get("/api/personality/recreation/status", async (req, res) => {
        try {
          const payload = await buildRecreationStatusPayload(api, req.query.limit);
          res.json({ ok: true, ...payload });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load recreation status") });
        }
      });

      app.post("/api/personality/recreation/trigger", async (_req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const ensureRecreationJob = requireRuntimeFn(runtime, "ensureRecreationJob");
          const noteInteractiveActivity = requireRuntimeFn(runtime, "noteInteractiveActivity");
          if (!ensureRecreationJob) {
            return res.status(503).json({ ok: false, error: "personality runtime context is unavailable" });
          }
          if (noteInteractiveActivity) {
            noteInteractiveActivity();
          }
          const task = await ensureRecreationJob({ immediate: true });
          const status = await buildRecreationStatusPayload(api, 10);
          res.json({ ok: true, task, ...status });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to trigger recreation") });
        }
      });
    }
  };
}

export default createPersonalityPlugin;
