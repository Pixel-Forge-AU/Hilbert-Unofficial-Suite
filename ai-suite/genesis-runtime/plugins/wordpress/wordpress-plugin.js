/**
 * Plugin Name: WordPress
 * Plugin Slug: wordpress
 * Description: Registers WordPress-related UI extensions for Observer.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: No
 */

import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { createWordPressDomain } from "./lib/wordpress-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWordPressPlugin(options = {}) {
  const {
    pluginId = "wordpress",
    pluginName = "WordPress",
    description = "WordPress bridge secrets and related integration surfaces."
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
        tools: [
          "list_wordpress_sites",
          "save_wordpress_site",
          "remove_wordpress_site",
          "wordpress_test_connection",
          "wordpress_get_diagnostics",
          "wordpress_get_health",
          "wordpress_get_monitor_status",
          "wordpress_list_plugins",
          "wordpress_update_plugins",
          "wordpress_manage_plugin",
          "wordpress_recover_site",
          "wordpress_run_monitor",
          "wordpress_upsert_post",
          "wordpress_set_active_site"
        ],
        capabilities: [
          "subsystem:classify",
          "wordpress.listSites",
          "wordpress.saveSite",
          "wordpress.removeSite",
          "wordpress.testConnection",
          "wordpress.getDiagnostics",
          "wordpress.getHealth",
          "wordpress.getMonitorStatus",
          "wordpress.listPlugins",
          "wordpress.updatePlugins",
          "wordpress.managePlugin",
          "wordpress.recoverSite",
          "wordpress.runMonitor",
          "wordpress.upsertPost",
          "wordpress.setActiveSite",
          "wordpress.getActiveSite",
          "wordpress.buildSecretsCatalogData"
        ],
        hooks: [],
        runtimeContext: [
          "noteInteractiveActivity"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["secrets:get", "secrets:set", "secrets:has", "secrets:delete"]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      // Secret storage is delegated to the secrets plugin's capabilities (secrets:get/set/
      // has/delete) rather than the Nova-era runtimeContext secret functions, which nothing in
      // Genesis ever populates. normalizeSecretHandle/buildWordPressSharedSecretHandle are pure
      // string helpers with no storage dependency, so they're implemented locally.
      const normalizeSecretHandle = (value = "") => String(value || "").trim();
      const buildWordPressSharedSecretHandle = (siteId = "") =>
        normalizeSecretHandle(["wordpress", String(siteId || "").trim(), "shared-secret"].filter(Boolean).join("/"));
      const getSecretValue = async (handle = "") => {
        const getSecret = api.getCapability("secrets:get");
        if (typeof getSecret !== "function") return "";
        return String((await getSecret({ handle })) || "");
      };
      const hasSecretValue = async (handle = "") => {
        const hasSecret = api.getCapability("secrets:has");
        if (typeof hasSecret !== "function") return false;
        return Boolean(await hasSecret({ handle }));
      };
      const setSecretValue = async (handle = "", value = "") => {
        const setSecret = api.getCapability("secrets:set");
        if (typeof setSecret !== "function") {
          throw new Error("secrets plugin is not available to store the WordPress shared secret");
        }
        return setSecret({ handle, value });
      };
      const deleteSecretValue = async (handle = "") => {
        const deleteSecret = api.getCapability("secrets:delete");
        if (typeof deleteSecret === "function") {
          await deleteSecret({ handle }).catch(() => {});
        }
      };
      const domain = createWordPressDomain({
        fs,
        path,
        registryPath: api.data.path("registry"),
        normalizeSecretHandle,
        buildWordPressSharedSecretHandle,
        getSecretValue,
        hasSecretValue,
        setSecretValue,
        deleteSecretValue
      });
      if (typeof api.provideCapability === "function") {
        api.provideCapability("wordpress.listSites", () => domain.listWordPressSites());
        api.provideCapability("wordpress.saveSite", (payload = {}) => domain.saveWordPressSite(payload));
        api.provideCapability("wordpress.removeSite", (payload = {}) => domain.removeWordPressSite(payload));
        api.provideCapability("wordpress.testConnection", (payload = {}) => domain.testConnection(payload));
        api.provideCapability("wordpress.getDiagnostics", (payload = {}) => domain.getDiagnostics(payload));
        api.provideCapability("wordpress.getHealth", (payload = {}) => domain.getHealth(payload));
        api.provideCapability("wordpress.getMonitorStatus", (payload = {}) => domain.getMonitorStatus(payload));
        api.provideCapability("wordpress.listPlugins", (payload = {}) => domain.listPlugins(payload));
        api.provideCapability("wordpress.updatePlugins", (payload = {}) => domain.updatePlugins(payload));
        api.provideCapability("wordpress.managePlugin", (payload = {}) => domain.managePlugin(payload));
        api.provideCapability("wordpress.recoverSite", (payload = {}) => domain.recoverSite(payload));
        api.provideCapability("wordpress.runMonitor", (payload = {}) => domain.runMonitor(payload));
        api.provideCapability("wordpress.upsertPost", (payload = {}) => domain.upsertPost(payload));
        api.provideCapability("wordpress.setActiveSite", (payload = {}) => domain.setActiveWordPressSite(payload));
        api.provideCapability("wordpress.getActiveSite", () => domain.getActiveWordPressSite());
        api.provideCapability("wordpress.buildSecretsCatalogData", () => domain.buildSecretsCatalogData());
      }
      function bindToolHandler(run) {
        return async (args = {}) => {
          try {
            const result = await run(args && typeof args === "object" ? args : {});
            return { ok: true, ...(result && typeof result === "object" && !Array.isArray(result) ? result : {}) };
          } catch (error) {
            return { ok: false, error: String(error?.message || error || "wordpress tool failed") };
          }
        };
      }
      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "list_wordpress_sites", description: "List configured WordPress sites available through the WordPress plugin.", scopes: ["worker"], risk: "normal" }, bindToolHandler(async () => ({ sites: await domain.listWordPressSites() })));
        api.registerTool({ name: "save_wordpress_site", description: "Save or update a WordPress site connection for the WordPress plugin.", scopes: ["worker"], risk: "high", parameters: { siteId: "string", label: "string", baseUrl: "string", keyId: "string", sharedSecret: "string", defaultStatus: "draft|publish|private|pending|future" } }, bindToolHandler(async (args) => ({ site: await domain.saveWordPressSite(args) })));
        api.registerTool({ name: "remove_wordpress_site", description: "Remove a configured WordPress site connection.", scopes: ["worker"], risk: "high", parameters: { siteId: "string" } }, bindToolHandler(async (args) => ({ site: await domain.removeWordPressSite(args) })));
        api.registerTool({ name: "wordpress_test_connection", description: "Test the authenticated connection to a configured WordPress site. Omit siteId to target the active site.", scopes: ["worker"], risk: "high", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.testConnection(args)));
        api.registerTool({ name: "wordpress_get_diagnostics", description: "Fetch site diagnostics, plugin/update state, and recent debug log details from a configured WordPress site.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.getDiagnostics(args)));
        api.registerTool({ name: "wordpress_get_health", description: "Run WordPress health checks against the homepage, REST API, login page, and Nova bridge endpoint.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.getHealth(args)));
        api.registerTool({ name: "wordpress_get_monitor_status", description: "Fetch WordPress monitor settings, next run time, and the last monitor result.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.getMonitorStatus(args)));
        api.registerTool({ name: "wordpress_list_plugins", description: "List installed plugins on a configured WordPress site, including active state and update availability.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.listPlugins(args)));
        api.registerTool({ name: "wordpress_update_plugins", description: "Update one or more WordPress plugins on a configured site, or all plugins with available updates.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", plugins: "array|string", all: "boolean", timeoutMs: "number" } }, bindToolHandler((args) => domain.updatePlugins(args)));
        api.registerTool({ name: "wordpress_manage_plugin", description: "Activate or deactivate a WordPress plugin on a configured site.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", plugin: "string", action: "activate|deactivate", timeoutMs: "number" } }, bindToolHandler((args) => domain.managePlugin(args)));
        api.registerTool({ name: "wordpress_recover_site", description: "Run a WordPress recovery workflow that snapshots diagnostics, optionally updates plugins, toggles suspect plugins, and re-runs health checks.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", updateAllPlugins: "boolean", updatePlugins: "array|string", deactivatePlugins: "array|string", activatePlugins: "array|string", timeoutMs: "number" } }, bindToolHandler((args) => domain.recoverSite(args)));
        api.registerTool({ name: "wordpress_run_monitor", description: "Manually trigger the WordPress scheduled monitor immediately and return the latest result.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string", timeoutMs: "number" } }, bindToolHandler((args) => domain.runMonitor(args)));
        api.registerTool({ name: "wordpress_upsert_post", description: "Create or update a WordPress post on a configured site. Supports structured layout sections, inline images, and featured image assignment. Use wordpressPostId/postId or slug to update an existing post. Omit siteId to target the active site (switch modes with wordpress_set_active_site: dev or live).", scopes: ["worker"], risk: "high", parameters: { siteId: "string", wordpressPostId: "number", postId: "number", title: "string", content: "string", slug: "string", excerpt: "string", status: "draft|publish|private|pending|future", postType: "string", categories: "array|string", tags: "array|string", featuredImage: "object|string|number", featuredImageUrl: "string", featuredImageId: "number", intro: "string", sections: "array", inlineImages: "array", conclusion: "string", callToAction: "string", layout: "object", meta: "object", timeoutMs: "number" } }, bindToolHandler((args) => domain.upsertPost(args)));
        api.registerTool({ name: "wordpress_set_active_site", description: "Switch which WordPress site is active (dev or live mode). Calls that omit siteId target the active site. Accepts a siteId or an alias like dev/local or live/production.", scopes: ["worker"], risk: "normal", parameters: { siteId: "string (siteId or alias: dev|local|live|production)" } }, bindToolHandler((args) => domain.setActiveWordPressSite(args)));
      }
      if (typeof api.provideCapability === "function") {
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/wordpress/") || pathname.startsWith("/api/plugin-ui/wordpress/")) {
            next.add("wordpress");
          }
          return [...next];
        });
      }
      if (typeof api.registerUiSecretsTab === "function") {
        api.registerUiSecretsTab({
          id: "wordpress-secrets",
          title: "WordPress",
          order: 30,
          scriptUrl: "/api/plugin-ui/wordpress/secrets-tab.js"
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/wordpress/secrets-tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "wordpress-secrets-tab.js"));
      });

      app.get("/api/wordpress/sites", async (_req, res) => {
        try {
          const listSites = api.getCapability("wordpress.listSites");
          if (typeof listSites !== "function") {
            return res.status(503).json({ ok: false, error: "wordpress capability is unavailable" });
          }
          const sites = await listSites();
          res.json({ ok: true, sites });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list WordPress sites") });
        }
      });

      app.post("/api/wordpress/sites", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const noteInteractiveActivity = runtime?.noteInteractiveActivity;
          const saveSite = api.getCapability("wordpress.saveSite");
          if (typeof saveSite !== "function") {
            return res.status(503).json({ ok: false, error: "wordpress capability is unavailable" });
          }
          if (typeof noteInteractiveActivity === "function") {
            noteInteractiveActivity();
          }
          const site = await saveSite(req.body || {});
          res.json({ ok: true, site });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save WordPress site") });
        }
      });

      app.delete("/api/wordpress/sites/:siteId", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const noteInteractiveActivity = runtime?.noteInteractiveActivity;
          const removeSite = api.getCapability("wordpress.removeSite");
          if (typeof removeSite !== "function") {
            return res.status(503).json({ ok: false, error: "wordpress capability is unavailable" });
          }
          const siteId = String(req.params?.siteId || "").trim();
          if (!siteId) {
            return res.status(400).json({ ok: false, error: "siteId is required" });
          }
          if (typeof noteInteractiveActivity === "function") {
            noteInteractiveActivity();
          }
          const site = await removeSite({ siteId });
          res.json({ ok: true, site });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to remove WordPress site") });
        }
      });
    }
  };
}
