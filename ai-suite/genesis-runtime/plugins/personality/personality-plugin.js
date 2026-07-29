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

// Reinterprets Nova's observer-recreation-job.js for Genesis: the original tracked a
// dedicated "agent_recreation" internalJobType across Nova's rich task-queue folders
// (queued/inProgress/done/closed), a shape agent-runtime-plugin.js's task model doesn't
// have (no internalJobType tag, no "closed" history bucket, no notBeforeAt delay). Since
// there's no way to filter agent-runtime's tasks by job type, this plugin tracks its own
// list of recreation task ids (in its own data store, now that it has one) and looks each
// one up via tasks:get, deriving scheduled/running/recent from the task's actual status.
async function buildRecreationStatusPayload(api, limitInput = 10) {
  const getTask = api.getCapability("tasks:get");
  if (typeof getTask !== "function") {
    throw new Error("no plugin provides the tasks:get capability (install agent-runtime)");
  }
  const limit = Math.min(20, Math.max(1, Number(limitInput || 10) || 10));
  const state = (await api.data.readJson("recreation", { taskIds: [] })) || { taskIds: [] };
  const tasks = (await Promise.all(state.taskIds.map((id) => getTask({ taskId: id })))).filter(Boolean);

  const scheduledTask = tasks.find((task) => task.status === "queued") || null;
  const runningTask = tasks.find((task) => task.status === "in_progress") || null;
  const recentTasks = tasks
    .filter((task) => task.status === "done" || task.status === "failed")
    .sort((left, right) =>
      (Date.parse(right.completedAt || right.updatedAt || 0) || 0)
      - (Date.parse(left.completedAt || left.updatedAt || 0) || 0)
    )
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      status: task.status,
      startedAt: task.startedAt || null,
      completedAt: task.completedAt || null,
      summary: String(task.result?.text || task.error || "").trim(),
      brain: task.brainId || null
    }));

  return {
    scheduled: scheduledTask ? { id: scheduledTask.id } : null,
    running: runningTask ? { id: runningTask.id, startedAt: runningTask.startedAt || null, brain: runningTask.brainId || null } : null,
    recent: recentTasks
  };
}

async function ensureRecreationJob(api) {
  const createTask = api.getCapability("tasks:create");
  if (typeof createTask !== "function") {
    throw new Error("no plugin provides the tasks:create capability (install agent-runtime)");
  }
  const task = await createTask({
    request: "Reflective self-check: review your recent task history and note anything about your own behavior, tools, or instructions that should change. Keep it brief and concrete."
  });
  const state = (await api.data.readJson("recreation", { taskIds: [] })) || { taskIds: [] };
  state.taskIds = [...state.taskIds, task.id].slice(-50);
  await api.data.writeJson("recreation", state);
  return task;
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
        data: true,
        capabilities: [
          "subsystem:classify"
        ],
        hooks: [],
        runtimeContext: []
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["tasks:create", "tasks:get"]
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
          const task = await ensureRecreationJob(api);
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
