/**
 * Plugin Name: Governance
 * Plugin Slug: governance
 * Description: Builds an inspectable governance surface across workflow execution, policy, memory, and validation.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createGovernanceRuntime } from "./lib/governance-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createGovernancePlugin(options = {}) {
  const {
    pluginId = "governance",
    pluginName = "Governance",
    description = "Inspectable ORCH, GOV, MEM, and MIRROR surfaces for trusted agent runs."
  } = options;

  let governanceRuntime = null;

  function getRuntime(api) {
    if (!governanceRuntime) {
      governanceRuntime = createGovernanceRuntime({
        api,
        pluginId
      });
    }
    return governanceRuntime;
  }

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
          "governance.summary",
          "governance.runs",
          "governance.run",
          "governance.refresh"
        ],
        hooks: [
          "http:request-completed",
          "observer:event",
          "permissions:decision",
          "runtime:startup",
          "worker:execution:started",
          "worker:execution:completed",
          "worker:execution:failed",
          "worker:tool-call:started",
          "worker:tool-call:completed",
          "queue:task-processed",
          "queue:task-dispatch-started",
          "queue:batch-started",
          "queue:batch-processed"
        ],
        runtimeContext: [
          "findTaskById",
          "listAllTasks"
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
      const runtime = getRuntime(api);
      await runtime.ready;

      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "governance",
          title: "Governance",
          icon: "GOV",
          order: 26,
          scriptUrl: "/api/plugin-ui/governance/tab.js"
        });
      }

      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "governance-control",
          title: "Governance Surface",
          description: "Refresh the governance ledger and inspect the latest ORCH, GOV, MEM, and MIRROR summary.",
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
              id: "summary",
              label: "Summary",
              method: "GET",
              endpoint: "/api/governance/summary",
              expects: "json"
            },
            {
              id: "refresh",
              label: "Refresh",
              method: "POST",
              endpoint: "/api/governance/refresh",
              expects: "json"
            },
            {
              id: "run",
              label: "Inspect Run",
              method: "GET",
              endpoint: "/api/governance/run",
              queryFields: ["task_id"],
              expects: "json"
            }
          ]
        });
      }

      api.provideCapability("governance.summary", async (limit) => runtime.buildSummary(limit));
      api.provideCapability("governance.runs", async (limit) => runtime.listRunSnapshots(limit));
      api.provideCapability("governance.run", async (taskId) => runtime.getRunSnapshot(taskId));
      api.provideCapability("governance.refresh", async () => {
        await runtime.hydrateFromTasks();
        return runtime.buildSummary(24);
      });

      if (typeof api.addHook === "function") {
        api.addHook("runtime:startup", async (payload = {}) => {
          await runtime.hydrateFromTasks();
          return payload;
        }, { priority: 80 });

        api.addHook("permissions:decision", async (payload = {}) => {
          await runtime.ingestPermissionDecision(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("observer:event", async (payload = {}) => {
          await runtime.ingestObserverEvent(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("http:request-completed", async (payload = {}) => {
          await runtime.ingestHttpEvent(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("worker:execution:started", async (payload = {}) => {
          await runtime.ingestWorkerExecution(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("worker:execution:completed", async (payload = {}) => {
          await runtime.ingestWorkerExecution(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("worker:execution:failed", async (payload = {}) => {
          await runtime.ingestWorkerExecution(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("worker:tool-call:started", async (payload = {}) => {
          await runtime.ingestWorkerToolCall(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("worker:tool-call:completed", async (payload = {}) => {
          await runtime.ingestWorkerToolCall(payload);
          return payload;
        }, { priority: 80 });

        api.addHook("queue:task-dispatch-started", async (payload = {}) => {
          if (payload?.task && typeof payload.task === "object") {
            runtime.mergeTaskIntoRun(payload.task);
          }
          return payload;
        }, { priority: 80 });

        api.addHook("queue:task-processed", async (payload = {}) => {
          if (payload?.task && typeof payload.task === "object") {
            runtime.mergeTaskIntoRun(payload.task);
          }
          return payload;
        }, { priority: 80 });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/governance/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "governance-tab.js"));
      });

      app.get("/api/governance/summary", async (req, res) => {
        try {
          const getSummary = api.getCapability("governance.summary");
          if (typeof getSummary !== "function") {
            return res.status(503).json({ ok: false, error: "governance summary capability is unavailable" });
          }
          const limit = Number(req.query.limit || 24);
          const summary = await getSummary(limit);
          res.json({ ok: true, summary });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load governance summary") });
        }
      });

      app.get("/api/governance/runs", async (req, res) => {
        try {
          const getRuns = api.getCapability("governance.runs");
          if (typeof getRuns !== "function") {
            return res.status(503).json({ ok: false, error: "governance runs capability is unavailable" });
          }
          const limit = Number(req.query.limit || 24);
          const runs = await getRuns(limit);
          res.json({ ok: true, runs });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load governance runs") });
        }
      });

      app.get("/api/governance/run", async (req, res) => {
        try {
          const taskId = String(req.query.taskId || req.query.task_id || "").trim();
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const getRun = api.getCapability("governance.run");
          if (typeof getRun !== "function") {
            return res.status(503).json({ ok: false, error: "governance run capability is unavailable" });
          }
          const run = await getRun(taskId);
          if (!run) {
            return res.status(404).json({ ok: false, error: "run not found" });
          }
          res.json({ ok: true, run });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load governance run") });
        }
      });

      app.post("/api/governance/refresh", async (_req, res) => {
        try {
          const refresh = api.getCapability("governance.refresh");
          if (typeof refresh !== "function") {
            return res.status(503).json({ ok: false, error: "governance refresh capability is unavailable" });
          }
          const summary = await refresh();
          res.json({ ok: true, summary });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to refresh governance state") });
        }
      });
    }
  };
}

export default createGovernancePlugin;
