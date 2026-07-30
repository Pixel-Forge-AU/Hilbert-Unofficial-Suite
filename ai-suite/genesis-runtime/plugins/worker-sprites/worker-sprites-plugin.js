/**
 * Plugin Name: Worker Sprites
 * Plugin Slug: worker-sprites
 * Description: Adds a live Nova canvas overlay for busy worker tasks.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toTitleCase(value = "") {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function pickTaskDescription(task = {}) {
  const description = compactText(task.projectWorkFocus || task.focus || task.description || task.message || task.notes || "", 96);
  if (description) {
    return description;
  }
  const projectTitle = compactText(task.projectName || task.projectTitle || "", 72);
  if (projectTitle) {
    return projectTitle;
  }
  const internalJobType = String(task.internalJobType || "").trim();
  if (internalJobType) {
    return compactText(toTitleCase(internalJobType), 72);
  }
  return "Working";
}

function normalizeBusyTask(task = {}) {
  return {
    id: String(task.id || "").trim(),
    codename: String(task.codename || "").trim(),
    taskLabel: String(task.taskLabel || "").trim(),
    status: String(task.status || "").trim(),
    label: compactText(task.codename || task.requestedBrainLabel || task.requestedBrainId || "Worker", 28),
    description: pickTaskDescription(task),
    projectName: String(task.projectName || "").trim(),
    projectTitle: String(task.projectTitle || "").trim(),
    projectWorkFocus: String(task.projectWorkFocus || task.focus || "").trim(),
    projectWorkRoleName: String(task.projectWorkRoleName || task.roleName || "").trim(),
    projectWorkRoleReason: compactText(task.projectWorkRoleReason || task.roleReason || "", 180),
    failureClassification: String(task.failureClassification || "").trim(),
    reshapeAttemptCount: Number(task.reshapeAttemptCount || 0) || 0,
    message: String(task.message || "").trim(),
    notes: String(task.notes || "").trim(),
    internalJobType: String(task.internalJobType || "").trim(),
    brainId: String(task.requestedBrainId || "").trim(),
    brainLabel: String(task.requestedBrainLabel || task.requestedBrainId || "worker").trim(),
    model: String(task.model || "").trim(),
    startedAt: Number(task.startedAt || 0) || null,
    updatedAt: Number(task.updatedAt || task.startedAt || 0) || null
  };
}

function isBusyWorkerTask(task = {}) {
  const status = String(task?.status || "").trim().toLowerCase();
  if (status !== "in_progress") {
    return false;
  }
  const brainId = String(task?.requestedBrainId || task?.brainId || "").trim().toLowerCase();
  const brainLabel = String(task?.requestedBrainLabel || "").trim().toLowerCase();
  return !brainId || brainId.includes("worker") || brainLabel.includes("worker");
}

async function buildBusyWorkerPayload(api) {
  const runtime = api.getRuntimeContext();
  const listAllTasks = runtime && typeof runtime.listAllTasks === "function"
    ? runtime.listAllTasks
    : null;
  if (!listAllTasks) {
    throw new Error("worker sprite runtime context is unavailable");
  }
  const allTasks = await listAllTasks();
  const inProgress = Array.isArray(allTasks?.inProgress) ? allTasks.inProgress : [];
  const workers = inProgress
    .filter(isBusyWorkerTask)
    .map(normalizeBusyTask)
    .filter((task) => task.id)
    .sort((left, right) => Number(left.startedAt || 0) - Number(right.startedAt || 0));
  return {
    workers,
    count: workers.length,
    at: Date.now()
  };
}

export function createWorkerSpritesPlugin(options = {}) {
  const {
    pluginId = "worker-sprites",
    pluginName = "Worker Sprites",
    description = "Shows busy worker tasks as floating sprites around Nova."
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      startupPriority: 10,
      permissions: {
        routes: true,
        uiPanels: true,
        data: false,
        capabilities: [
          "subsystem:classify"
        ],
        hooks: ["queue:task-created"],
        runtimeContext: [
          "listAllTasks",
          "broadcastObserverEvent"
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
          if (pathname.startsWith("/api/worker-sprites/") || pathname.startsWith("/api/plugin-ui/worker-sprites/")) {
            next.add("avatar");
            next.add("worker-sprites");
          }
          return [...next];
        });
      }
      if (typeof api.addHook === "function") {
        api.addHook("queue:task-created", async (payload = {}) => {
          const runtime = api.getRuntimeContext?.() || {};
          const broadcastObserverEvent = typeof runtime.broadcastObserverEvent === "function"
            ? runtime.broadcastObserverEvent
            : null;
          if (!broadcastObserverEvent) {
            return payload;
          }
          const taskRef = compactText(String(payload?.codename || payload?.taskId || "queued task").trim(), 40);
          const brainId = compactText(String(payload?.brainId || "worker").trim(), 28);
          broadcastObserverEvent({
            type: "worker-sprites.request-queued",
            pluginId,
            taskRef,
            taskRefs: taskRef ? [taskRef] : [],
            destinationLabel: brainId || "worker",
            message: compactText(String(payload?.message || "Queued request").trim(), 96),
            source: "queue",
            taskId: String(payload?.taskId || "").trim(),
            at: Date.now()
          });
          return payload;
        });
      }
      if (typeof api.registerUiIdentityTab === "function") {
        api.registerUiIdentityTab({
          id: "worker-sprites",
          title: "Worker Sprites",
          order: 43,
          scriptUrl: "/api/plugin-ui/worker-sprites/nova-tab.js"
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/worker-sprites/nova-tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "worker-sprites-nova-tab.js"));
      });

      app.get("/api/worker-sprites/status", async (_req, res) => {
        try {
          const payload = await buildBusyWorkerPayload(api);
          res.json({ ok: true, ...payload });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load busy workers") });
        }
      });
    }
  };
}

export default createWorkerSpritesPlugin;
