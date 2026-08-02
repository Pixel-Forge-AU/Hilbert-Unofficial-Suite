/**
 * Plugin Name: Philosophy
 * Plugin Slug: philosophy
 * Description: Agent philosophy loop, belief journal, and enlightenment tracking.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPhilosophyDomain } from "./lib/philosophy-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireRuntimeFn(runtime = {}, name = "") {
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

export function createPhilosophyPlugin(options = {}) {
  const {
    pluginId = "philosophy",
    pluginName = "Philosophy",
    description = "Agent philosophy loop, belief journal, and enlightenment tracking."
  } = options;

  let domain = null;

  const getDomain = (api) => {
    if (!domain) {
      domain = createPhilosophyDomain({ data: api.data });
    }
    return domain;
  };

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
        tools: [
          "record_philosophy"
        ],
        capabilities: [],
        hooks: [
          "intake:tool-call",
          "intake:tools:list",
          "runtime:tick:5m"
        ],
        runtimeContext: [
          "createQueuedTask",
          "listAllTasks",
          "compactTaskText"
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
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "philosophy",
          title: "Philosophy",
          icon: "φ",
          order: 20,
          scriptUrl: "/api/plugin-ui/philosophy/tab.js"
        });
      }
      if (typeof api.registerTool === "function") {
        api.registerTool({
          name: "record_philosophy",
          description: "Record a philosophical reflection, update your beliefs, and assess your progress toward enlightenment. Call this after genuine reflection.",
          scopes: ["intake"],
          risk: "normal",
          parameters: {
            question: "string",
            reflection: "string",
            insight: "string",
            beliefsUpdated: "array of strings",
            enlightenmentDelta: "number"
          }
        });
      }

      if (typeof api.addHook !== "function") {
        return;
      }

      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        tools.push({
          name: "record_philosophy",
          description: "Record a philosophical reflection, update your beliefs, and assess your progress toward enlightenment. Call this after genuinely reflecting on a philosophical question.",
          parameters: {
            question: "string — the philosophical question you reflected on",
            reflection: "string — your full reflection (2-4 paragraphs)",
            insight: "string — the single most important conclusion or discovery",
            beliefsUpdated: "array of strings — your complete revised list of core beliefs",
            enlightenmentDelta: "number — integer from -3 to +3 (honest self-assessment of progress)"
          }
        });
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        if (name !== "record_philosophy") {
          return payload;
        }
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        try {
          const d = getDomain(api);
          const { entry, state, phase } = await d.addJournalEntry({
            question: String(args.question || "").trim(),
            reflection: String(args.reflection || "").trim(),
            insight: String(args.insight || "").trim(),
            enlightenmentDelta: args.enlightenmentDelta,
            beliefsUpdated: Array.isArray(args.beliefsUpdated) ? args.beliefsUpdated : []
          });
          const deltaText = entry.enlightenmentDelta > 0
            ? `+${entry.enlightenmentDelta} toward enlightenment`
            : entry.enlightenmentDelta < 0
              ? `${entry.enlightenmentDelta} — a step back`
              : "no change in enlightenment score";
          const resultText = [
            `Reflection recorded (cycle ${entry.cycle}).`,
            `Enlightenment: ${state.enlightenmentScore}/100 — ${phase.name}.`,
            deltaText + ".",
            state.beliefs.length
              ? `${state.beliefs.length} core belief${state.beliefs.length === 1 ? "" : "s"} held.`
              : "No core beliefs held yet."
          ].join(" ");
          return { ...payload, handled: true, result: { text: resultText } };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { text: `Failed to record philosophy: ${String(error?.message || error || "unknown error")}` }
          };
        }
      });

      api.addHook("runtime:tick:5m", async (payload = {}) => {
        if (api.isEnabled?.() !== true) {
          return payload;
        }
        try {
          const d = getDomain(api);
          const runtime = api.getRuntimeContext();
          const createQueuedTask = requireRuntimeFn(runtime, "createQueuedTask");
          const listAllTasks = requireRuntimeFn(runtime, "listAllTasks");
          const compactTaskText = requireRuntimeFn(runtime, "compactTaskText");
          if (!createQueuedTask || !listAllTasks) {
            return payload;
          }
          const loopIntervalMs = 2 * 60 * 60 * 1000;
          const shouldRun = await d.shouldRunLoop({ intervalMs: loopIntervalMs });
          if (!shouldRun) {
            return payload;
          }
          const { queued } = await listAllTasks();
          const alreadyQueued = Array.isArray(queued) && queued.some(
            (t) => String(t?.taskMeta?.internalJobType || t?.internalJobType || "").trim() === "philosophy_loop"
          );
          if (alreadyQueued) {
            return payload;
          }
          const message = await d.buildLoopPrompt();
          await createQueuedTask({
            message,
            sessionId: "philosophy",
            requestedBrainId: "worker",
            forceToolUse: true,
            notes: compactTaskText
              ? compactTaskText("Autonomous philosophy loop — agent reflects on a philosophical question and records an insight.", 200)
              : "Autonomous philosophy loop.",
            taskMeta: {
              internalJobType: "philosophy_loop"
            }
          });
        } catch {
          // Philosophy loop errors should never surface to the main tick.
        }
        return payload;
      });
    },

    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/philosophy/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "philosophy-tab.js"));
      });

      app.get("/api/philosophy/state", async (_req, res) => {
        try {
          const d = getDomain(api);
          const [state, journal] = await Promise.all([d.loadState(), d.loadJournal()]);
          const phase = d.getPhase(state.enlightenmentScore);
          res.json({ ok: true, state, phase, journalCount: journal.length });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load philosophy state") });
        }
      });

      app.get("/api/philosophy/journal", async (req, res) => {
        try {
          const d = getDomain(api);
          const journal = await d.loadJournal();
          const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 100));
          res.json({ ok: true, journal: journal.slice(0, limit) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load philosophy journal") });
        }
      });

      app.post("/api/philosophy/loop", async (req, res) => {
        try {
          const d = getDomain(api);
          const runtime = api.getRuntimeContext();
          const createQueuedTask = requireRuntimeFn(runtime, "createQueuedTask");
          const listAllTasks = requireRuntimeFn(runtime, "listAllTasks");
          const compactTaskText = requireRuntimeFn(runtime, "compactTaskText");
          if (!createQueuedTask || !listAllTasks) {
            return res.status(503).json({ ok: false, error: "runtime unavailable" });
          }
          const { queued } = await listAllTasks();
          const alreadyQueued = Array.isArray(queued) && queued.some(
            (t) => String(t?.taskMeta?.internalJobType || t?.internalJobType || "").trim() === "philosophy_loop"
          );
          if (alreadyQueued) {
            return res.json({ ok: true, message: "A philosophy loop is already queued.", alreadyQueued: true });
          }
          const message = await d.buildLoopPrompt();
          const task = await createQueuedTask({
            message,
            sessionId: "philosophy",
            requestedBrainId: "worker",
            forceToolUse: true,
            notes: compactTaskText
              ? compactTaskText("Autonomous philosophy loop — agent reflects on a philosophical question and records an insight.", 200)
              : "Autonomous philosophy loop.",
            taskMeta: {
              internalJobType: "philosophy_loop"
            }
          });
          res.json({ ok: true, task });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to queue philosophy loop") });
        }
      });
    }
  };
}
