/**
 * Plugin Name: Presence
 * Plugin Slug: presence
 * Description: Observes passive voice context and turns useful ambient signals into reviewable actions.
 * Version: 0.1.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPresenceDomain } from "./lib/presence-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createPresencePlugin(options = {}) {
  const {
    pluginId = "presence",
    pluginName = "Presence",
    description = "Passive voice context observation and action drafting."
  } = options;
  let domain = null;
  const getDomain = (api) => {
    if (!domain) {
      domain = createPresenceDomain({
        data: api.data,
        runtime: api.getRuntimeContext(),
        getCapability: (name) => api.getCapability(name),
        broadcast: (event) => api.broadcast(event)
      });
    }
    return domain;
  };

  return {
    id: pluginId,
    name: pluginName,
    version: "0.1.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        capabilities: [
          "presence.runtime",
          "subsystem:classify"
        ],
        hooks: [],
        runtimeContext: [
          "createQueuedTask",
          "noteInteractiveActivity"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: [
          "todo.addItem",
          "calendar.saveEvent"
        ]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      const presence = getDomain(api);
      api.provideCapability?.("presence.runtime", () => presence, { priority: 10 });
      api.provideCapability?.("subsystem:classify", (payload = {}) => {
        const pathname = String(payload?.path || "").trim().toLowerCase();
        const existing = Array.isArray(payload?.subsystems)
          ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
          : [];
        const next = new Set(existing);
        if (pathname.startsWith("/api/presence/") || pathname.startsWith("/api/plugin-ui/presence/")) {
          next.add("presence");
          next.add("voice");
        }
        return [...next];
      });
      api.registerUiTab?.({
        id: "presence",
        title: "Presence",
        icon: "Pr",
        order: 18,
        scriptUrl: "/api/plugin-ui/presence/tab.js"
      });
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/presence/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "presence-tab.js"));
      });

      app.get("/api/presence/status", async (_req, res) => {
        try {
          const presence = getDomain(api);
          const [settings, observations, threads, people] = await Promise.all([
            presence.readSettings(),
            presence.listObservations({ limit: 80 }),
            presence.listThreads({ limit: 30 }),
            presence.listPeople()
          ]);
          res.json({ ok: true, settings, observations, threads, people, at: Date.now() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load presence status") });
        }
      });

      app.post("/api/presence/settings", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          runtime.noteInteractiveActivity?.();
          const settings = await getDomain(api).writeSettings(req.body || {});
          res.json({ ok: true, settings });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save presence settings") });
        }
      });

      app.post("/api/presence/observe", async (req, res) => {
        try {
          const result = await getDomain(api).observe({
            ...(req.body && typeof req.body === "object" ? req.body : {}),
            source: req.body?.source || "voice"
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to observe presence input") });
        }
      });
    }
  };
}

export default createPresencePlugin;
