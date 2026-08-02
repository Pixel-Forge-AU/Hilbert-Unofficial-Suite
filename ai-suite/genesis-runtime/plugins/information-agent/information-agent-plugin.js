/**
 * Plugin Name: Information Agent
 * Plugin Slug: information-agent
 * Description: Monitors the web for user-defined interests and pushes synthesized change updates.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInformationAgentDomain } from "./lib/information-agent-domain.js";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function handled(payload = {}, result = null) {
  return { ...payload, handled: true, result };
}

function normalizeSessionId(source = {}) {
  return `information-agent:${String(source.id || "default").trim().toLowerCase() || "default"}`;
}

async function fetchWithNode(source = {}) {
  const url = String(source.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("source URL must start with http:// or https://");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "Nova Information Agent/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`fetch failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceText(api, source = {}) {
  const browserDaemonFactory = source.useBrowser === true ? api.getCapability("browser.daemon") : null;
  if (typeof browserDaemonFactory === "function") {
    const daemon = browserDaemonFactory();
    const sessionId = normalizeSessionId(source);
    await daemon.navigate(String(source.url || ""), { sessionId, waitUntil: "domcontentloaded", timeoutMs: 30000 });
    const selector = String(source.selector || "body").trim() || "body";
    return await daemon.getText(selector, { sessionId });
  }
  return await fetchWithNode(source);
}

function createTools() {
  return [
    {
      name: "info_agent_save_interest",
      description: "Tell Nova what information you care about, including keywords and categories to monitor.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { id: "string", name: "string", prompt: "string", keywords: "array|string", categories: "array|string", priority: "1-5", digestStyle: "string" }
    },
    {
      name: "info_agent_add_source",
      description: "Add a blog, news, social, finance, shopping, or web URL to monitor for an interest.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { interestId: "string", id: "string", type: "blog|news|social|finance|shopping|web", label: "string", url: "string", selector: "string", intervalMinutes: "number", useBrowser: "boolean" }
    },
    {
      name: "info_agent_run_scan",
      description: "Run Information Agent monitoring now and return synthesized updates for changed sources.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { sourceId: "string", interestId: "string", limit: "number", emitBaseline: "boolean" }
    },
    {
      name: "info_agent_list_updates",
      description: "List recent synthesized Information Agent updates and monitor status.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { onlyUnacknowledged: "boolean", limit: "number" }
    },
    {
      name: "info_agent_ack_update",
      description: "Acknowledge or unacknowledge a synthesized Information Agent update.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { updateId: "string", acknowledged: "boolean" }
    }
  ];
}

export function createInformationAgentPlugin(options = {}) {
  const {
    pluginId = "information-agent",
    pluginName = "Information Agent",
    description = "User-defined web monitoring for blogs, news, social posts, finance, and shopping changes."
  } = options;

  let domain = null;
  let scanInFlight = false;
  let lastAutomaticScanAt = 0;
  const tools = createTools();

  const getDomain = (api) => {
    if (!domain) {
      domain = createInformationAgentDomain({
        dataApi: api.data,
        broadcast: (event) => api.broadcast(event)
      });
    }
    return domain;
  };

  async function runScans(api, args = {}) {
    const d = getDomain(api);
    const sourceId = String(args.sourceId || "").trim();
    if (sourceId) {
      const result = await d.scanSource(sourceId, {
        fetchText: (source) => fetchSourceText(api, source),
        emitBaseline: args.emitBaseline === true
      });
      return {
        scannedCount: 1,
        changedCount: result.changed ? 1 : 0,
        updateCount: result.update ? 1 : 0,
        results: [result]
      };
    }
    const state = await d.listState();
    const interestId = String(args.interestId || "").trim();
    const limit = Math.max(1, Math.min(Number(args.limit || 8) || 8, 50));
    const matchingSources = interestId
      ? state.sources.filter((source) => source.interestId === interestId).slice(0, limit)
      : null;
    if (matchingSources) {
      const results = [];
      for (const source of matchingSources) {
        results.push(await d.scanSource(source.id, {
          fetchText: (entry) => fetchSourceText(api, entry),
          emitBaseline: args.emitBaseline === true
        }));
      }
      return {
        scannedCount: results.length,
        changedCount: results.filter((entry) => entry.changed).length,
        updateCount: results.filter((entry) => entry.update).length,
        results
      };
    }
    return await d.runDueScans({
      fetchText: (source) => fetchSourceText(api, source),
      limit,
      emitBaseline: args.emitBaseline === true,
      includeNotDue: args.includeNotDue === true
    });
  }

  async function handleToolCall(api, payload = {}) {
    const name = String(payload?.name || "").trim();
    const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    const d = getDomain(api);

    if (name === "info_agent_save_interest") {
      const interest = await d.saveInterest(args);
      return handled(payload, { text: `Information interest saved: ${interest.name} (${interest.id}).`, interest });
    }

    if (name === "info_agent_add_source") {
      const source = await d.saveSource(args);
      return handled(payload, { text: `Information source saved: ${source.label} (${source.type}).`, source });
    }

    if (name === "info_agent_run_scan") {
      const result = await runScans(api, { ...args, includeNotDue: true });
      const updates = result.results.map((entry) => entry.update).filter(Boolean);
      return handled(payload, {
        text: updates.length
          ? updates.map((update) => `- ${update.title}: ${compactText(update.summary, 240)}`).join("\n")
          : `Scanned ${result.scannedCount} source${result.scannedCount === 1 ? "" : "s"}; no changes found.`,
        ...result,
        updates
      });
    }

    if (name === "info_agent_list_updates") {
      const state = await d.listState();
      const limit = Math.max(1, Math.min(Number(args.limit || 10) || 10, 50));
      const updates = state.updates
        .filter((entry) => args.onlyUnacknowledged === true ? !entry.acknowledged : true)
        .slice(0, limit);
      return handled(payload, {
        text: updates.length
          ? updates.map((update) => `- ${update.id}: ${update.title} (${update.acknowledged ? "acknowledged" : "new"})`).join("\n")
          : "No Information Agent updates found.",
        updates,
        summary: state.summary
      });
    }

    if (name === "info_agent_ack_update") {
      const update = await d.acknowledgeUpdate(args.updateId || args.id, args.acknowledged !== false);
      return handled(payload, { text: `Update ${update.id} ${update.acknowledged ? "acknowledged" : "reopened"}.`, update });
    }

    return payload;
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
        tools: tools.map((tool) => tool.name),
        capabilities: [
          "subsystem:classify",
          "informationAgent.listState",
          "informationAgent.saveInterest",
          "informationAgent.saveSource",
          "informationAgent.runScans",
          "informationAgent.acknowledgeUpdate"
        ],
        hooks: [
          "intake:tools:list",
          "intake:tool-call",
          "runtime:startup",
          "runtime:tick:5m"
        ],
        runtimeContext: ["noteInteractiveActivity"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["browser.daemon"]
      },
      security: {
        isolation: "inprocess"
      }
    },

    async init(api) {
      const d = getDomain(api);

      if (typeof api.provideCapability === "function") {
        api.provideCapability("informationAgent.listState", () => d.listState());
        api.provideCapability("informationAgent.saveInterest", (input = {}) => d.saveInterest(input));
        api.provideCapability("informationAgent.saveSource", (input = {}) => d.saveSource(input));
        api.provideCapability("informationAgent.runScans", (input = {}) => runScans(api, input));
        api.provideCapability("informationAgent.acknowledgeUpdate", (updateId = "", acknowledged = true) => d.acknowledgeUpdate(updateId, acknowledged));
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/information-agent/") || pathname.startsWith("/api/plugin-ui/information-agent/")) {
            next.add("information-agent");
          }
          return [...next];
        });
      }

      if (typeof api.registerTool === "function") {
        for (const tool of tools) api.registerTool(tool);
      }

      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "information-agent",
          title: "Info Agent",
          icon: "I",
          order: 38,
          scriptUrl: "/api/plugin-ui/information-agent/tab.js"
        });
      }

      if (typeof api.addHook === "function") {
        api.addHook("intake:tools:list", async (payload = {}) => ({
          ...payload,
          tools: [
            ...(Array.isArray(payload?.tools) ? payload.tools : []),
            ...tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters || {} }))
          ]
        }));

        api.addHook("intake:tool-call", (payload = {}) => handleToolCall(api, payload));

        const tick = async (payload = {}) => {
          if (api.isEnabled?.() !== true || scanInFlight) return payload;
          const automaticScanIntervalMs = 60 * 60 * 1000;
          const elapsedMs = Date.now() - Number(lastAutomaticScanAt || 0);
          if (lastAutomaticScanAt && elapsedMs < automaticScanIntervalMs) return payload;
          scanInFlight = true;
          try {
            await runScans(api, { limit: 6 });
            lastAutomaticScanAt = Date.now();
          } catch {
            // Monitoring should never block the main runtime tick.
          } finally {
            scanInFlight = false;
          }
          return payload;
        };
        api.addHook("runtime:startup", tick);
        api.addHook("runtime:tick:5m", tick);
      }
    },

    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/information-agent/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "information-agent-tab.js"));
      });

      app.get("/api/information-agent/state", async (_req, res) => {
        try {
          const listState = api.getCapability("informationAgent.listState");
          if (typeof listState !== "function") {
            return res.status(503).json({ ok: false, error: "information agent capability is unavailable" });
          }
          res.json({ ok: true, ...(await listState()) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load information agent state") });
        }
      });

      app.post("/api/information-agent/interests", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          const saveInterest = api.getCapability("informationAgent.saveInterest");
          if (typeof saveInterest !== "function") {
            return res.status(503).json({ ok: false, error: "information agent capability is unavailable" });
          }
          res.json({ ok: true, interest: await saveInterest(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save interest") });
        }
      });

      app.post("/api/information-agent/sources", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          const saveSource = api.getCapability("informationAgent.saveSource");
          if (typeof saveSource !== "function") {
            return res.status(503).json({ ok: false, error: "information agent capability is unavailable" });
          }
          res.json({ ok: true, source: await saveSource(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save source") });
        }
      });

      app.post("/api/information-agent/scan", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          const run = api.getCapability("informationAgent.runScans");
          if (typeof run !== "function") {
            return res.status(503).json({ ok: false, error: "information agent capability is unavailable" });
          }
          res.json({ ok: true, ...(await run({ ...(req.body || {}), includeNotDue: true })) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "scan failed") });
        }
      });

      app.patch("/api/information-agent/updates/:updateId", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          const acknowledge = api.getCapability("informationAgent.acknowledgeUpdate");
          if (typeof acknowledge !== "function") {
            return res.status(503).json({ ok: false, error: "information agent capability is unavailable" });
          }
          res.json({ ok: true, update: await acknowledge(req.params.updateId, req.body?.acknowledged !== false) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update notification") });
        }
      });
    }
  };
}

export default createInformationAgentPlugin;
