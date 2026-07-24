import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadActiveProfile, getActiveProfile } from "./lib/profile-manager.js";
import { createAdminSecurity } from "./lib/admin-security.js";
import { createHttpHooks } from "./lib/http-hooks.js";
import { initializePluginManager } from "./lib/plugin-loader.js";

const CORE_VERSION = "0.1.0";
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRuntimeRoot = path.join(rootDir, "runtime-data");
const port = Number(process.env.PORT || 3300);

const sseClients = new Set();

function broadcast(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return;
  }
  console.log(text);
  const payload = `data: ${JSON.stringify({ message: text, at: Date.now() })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

async function main() {
  await fs.mkdir(pluginRuntimeRoot, { recursive: true });
  await fs.mkdir(path.join(rootDir, "plugins"), { recursive: true });

  const profile = await loadActiveProfile({ fs, rootDir, logger: console });

  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Observer Compat is the shared compatibility contract other orchestrators (Nova, Omega, ...)
  // rely on. Serve it at a stable path so browser-side plugin tabs can depend on it.
  app.use("/observer-compat", express.static(path.join(rootDir, "observer-compat")));
  app.use(express.static(path.join(rootDir, "public")));

  app.get("/events/logs", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.flushHeaders?.();
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  const adminSecurity = createAdminSecurity({ port });
  adminSecurity.registerAdminSecurityMiddleware(app);

  const { pluginManager, pluginLoadErrors } = await initializePluginManager({
    app,
    broadcast,
    fs,
    getAppConfig: () => ({}),
    pathModule: path,
    profile,
    pluginRuntimeRoot,
    rootDir,
    runtimeContext: {},
    validateAdminRequest: adminSecurity.validateAdminRequest
  });

  const httpHooks = createHttpHooks({ getPluginManager: () => pluginManager });
  app.use(httpHooks.requestTrackingMiddleware);

  await pluginManager.registerRoutes();

  const startedAt = Date.now();
  app.get("/api/runtime/status", (req, res) => {
    res.json({
      ok: true,
      coreVersion: CORE_VERSION,
      nodeVersion: process.version,
      uptimeMs: Date.now() - startedAt,
      profile: { id: getActiveProfile().id, name: getActiveProfile().name },
      pluginLoadErrors
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/compat", (req, res) => {
    res.json({
      ok: true,
      contract: "nova-observer/observer-compat",
      mountPath: "/observer-compat"
    });
  });

  const server = app.listen(port, () => {
    console.log(`[genesis] listening on http://127.0.0.1:${port} (profile: ${profile.id})`);
    if (pluginLoadErrors.length) {
      console.warn(`[genesis] ${pluginLoadErrors.length} plugin load error(s):`, pluginLoadErrors);
    }
  });

  const shutdown = (signal) => {
    console.log(`[genesis] received ${signal}, shutting down.`);
    for (const client of sseClients) {
      client.end();
    }
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[genesis] fatal startup error:", error);
  process.exit(1);
});
