/**
 * Plugin Name: Developer Tools
 * Plugin Slug: developer-tools
 * Description: Combines Hook Explorer, Prompt Review, and State Browser into a single developer plugin.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { createBrainToolWorkoutService } from "./lib/brain-tool-workout-service.js";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRAIN_TOOL_WORKOUT_HISTORY_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".derpy-observer-runtime",
  "plugins-runtime",
  "developer-tools",
  "brain-tool-workout-history.jsonl"
);
const HARNESS_LAST_RUN_REPORT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".derpy-observer-runtime",
  "harness-last-run.json"
);
const HARNESS_CHECK_HISTORY_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".derpy-observer-runtime",
  "harness-check-history.jsonl"
);

// ─── Hook Explorer helpers ────────────────────────────────────────────────────

function normalizeNumber(value = 0, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}


function sanitizeHookToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizePayload(value = null, depth = 0) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return compactText(value, 500);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) {
      return `array:${value.length}`;
    }
    if (typeof value === "object") {
      return `object:${Object.keys(value).length}`;
    }
    return compactText(String(value), 120);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizePayload(entry, depth + 1));
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 40);
    return Object.fromEntries(
      keys.map((key) => [key, sanitizePayload(value[key], depth + 1)])
    );
  }
  return compactText(String(value), 120);
}

async function readJsonLineRecords(filePath = "", maxRecords = 1000) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const limited = lines.slice(Math.max(0, lines.length - Math.max(1, Number(maxRecords || 1000))));
  const records = [];
  for (const line of limited) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip corrupt history lines instead of breaking diagnostics.
    }
  }
  return records;
}

async function appendJsonLineRecord(filePath = "", record = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function readJsonObject(filePath = "") {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function summarizeHarnessLastRun(report = null) {
  if (!report || typeof report !== "object") {
    return null;
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failedCheck = report.failedCheck && typeof report.failedCheck === "object" ? report.failedCheck : null;
  return {
    ok: report.ok === true,
    startedAt: Number(report.startedAt || 0),
    completedAt: Number(report.completedAt || 0),
    durationMs: Number(report.durationMs || 0),
    audit: report.audit && typeof report.audit === "object" ? {
      ok: report.audit.ok === true,
      syntaxTargetCount: Number(report.audit.syntaxTargetCount || 0),
      testTargetCount: Number(report.audit.testTargetCount || 0),
      featureTokenCount: Number(report.audit.featureTokenCount || 0)
    } : null,
    totals: report.totals && typeof report.totals === "object" ? {
      checkCount: Number(report.totals.checkCount || 0),
      passedCount: Number(report.totals.passedCount || 0),
      failedCount: Number(report.totals.failedCount || 0)
    } : null,
    failedCheck: failedCheck ? {
      label: String(failedCheck.label || "").trim(),
      command: compactText(failedCheck.command || "", 300),
      status: Number(failedCheck.status || 0),
      durationMs: Number(failedCheck.durationMs || 0),
      error: compactText(failedCheck.error || "", 300)
    } : null,
    error: compactText(report.error || "", 500),
    checks: checks.slice(-20).map((check) => ({
      label: String(check?.label || "").trim(),
      command: compactText(check?.command || "", 220),
      ok: check?.ok === true,
      status: Number(check?.status || 0),
      durationMs: Number(check?.durationMs || 0),
      stdoutChars: Number(check?.stdoutChars || 0),
      stderrChars: Number(check?.stderrChars || 0)
    }))
  };
}

function normalizeHarnessHistoryRecord(record = null) {
  if (!record || typeof record !== "object") return null;
  return {
    ok: record.ok === true,
    startedAt: Number(record.startedAt || 0),
    completedAt: Number(record.completedAt || 0),
    durationMs: Number(record.durationMs || 0),
    audit: record.audit && typeof record.audit === "object" ? {
      syntaxTargetCount: Number(record.audit.syntaxTargetCount || 0),
      testTargetCount: Number(record.audit.testTargetCount || 0),
      featureTokenCount: Number(record.audit.featureTokenCount || 0)
    } : null,
    totals: record.totals && typeof record.totals === "object" ? {
      checkCount: Number(record.totals.checkCount || 0),
      passedCount: Number(record.totals.passedCount || 0),
      failedCount: Number(record.totals.failedCount || 0)
    } : null,
    failedCheck: record.failedCheck && typeof record.failedCheck === "object" ? {
      label: String(record.failedCheck.label || "").trim(),
      command: compactText(record.failedCheck.command || "", 300),
      status: Number(record.failedCheck.status || 0)
    } : null,
    error: compactText(record.error || "", 500)
  };
}

function summarizeHarnessHistory(records = []) {
  const history = (Array.isArray(records) ? records : [])
    .map((record) => normalizeHarnessHistoryRecord(record))
    .filter(Boolean)
    .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0));
  const recent = history.slice(0, 10);
  const latest = recent[0] || null;
  const previous = recent[1] || null;
  const passCount = recent.filter((record) => record.ok).length;
  const avgDurationMs = recent.length
    ? Math.round(recent.reduce((sum, record) => sum + Number(record.durationMs || 0), 0) / recent.length)
    : 0;
  const durationDeltaMs = latest && previous
    ? Number(latest.durationMs || 0) - Number(previous.durationMs || 0)
    : null;
  const reasons = [];
  if (latest && latest.ok !== true) reasons.push("latest_failed");
  if (recent.length >= 3 && passCount < recent.length) reasons.push("recent_failures");
  if (durationDeltaMs != null && durationDeltaMs > Math.max(1000, Number(previous?.durationMs || 0) * 0.5)) {
    reasons.push("duration_regressed");
  }
  let status = "unknown";
  if (recent.length) {
    status = reasons.includes("latest_failed") || reasons.includes("recent_failures") ? "needs_attention" : (reasons.length ? "watch" : "healthy");
  }
  return {
    status,
    reasons,
    sampleCount: history.length,
    recentCount: recent.length,
    passRate: recent.length ? Number((passCount / recent.length).toFixed(3)) : 0,
    avgDurationMs,
    latestOk: latest ? latest.ok === true : null,
    previousOk: previous ? previous.ok === true : null,
    durationDeltaMs,
    lastFailureCommand: (recent.find((record) => !record.ok)?.failedCheck?.command || "")
  };
}

function inferSubsystem(payload = {}) {
  const subsystem = sanitizeHookToken(payload?.subsystem || "");
  if (subsystem) {
    return subsystem;
  }
  const subsystems = Array.isArray(payload?.subsystems)
    ? payload.subsystems.map((entry) => sanitizeHookToken(entry)).filter(Boolean)
    : [];
  if (subsystems.length === 1) {
    return subsystems[0];
  }
  if (subsystems.length > 1) {
    return "multiple";
  }
  return "";
}

function normalizeHookSummary(hookName = "", payload = {}) {
  const hook = String(hookName || "").trim();
  const method = compactText(String(payload?.method || "").trim(), 12);
  const urlPath = compactText(String(payload?.path || "").trim(), 180);
  const eventType = compactText(String(payload?.type || "").trim(), 120);
  if (hook.startsWith("http:request-")) {
    const statusCode = Number(payload?.statusCode || 0);
    if (hook.endsWith("started")) {
      return compactText(`${hook} ${method} ${urlPath}`.trim(), 260);
    }
    return compactText(
      `${hook} ${method} ${urlPath} ${statusCode || ""} ${Number(payload?.durationMs || 0) || 0}ms`.trim(),
      260
    );
  }
  if (hook.startsWith("observer:event")) {
    return compactText(`${hook} ${eventType}`.trim(), 260);
  }
  return compactText(`${hook} ${eventType || urlPath || ""}`.trim(), 260);
}

// ─── Plugin factory ───────────────────────────────────────────────────────────

export function createDeveloperToolsPlugin(options = {}) {
  const {
    pluginId = "developer-tools",
    pluginName = "Developer Tools",
    description = "Hook Explorer, Prompt Review, and State Browser in one plugin.",
    maxEvents = 1200
  } = options;

  // Hook Explorer state
  const normalizedMaxEvents = normalizeNumber(maxEvents, 1200, 200, 10_000);
  let sequence = 0;
  let droppedCount = 0;
  const events = [];
  const hookCounts = new Map();
  const subscribedHooks = new Set();

  function recordHookEvent(hookName = "", payload = {}) {
    const hook = String(hookName || "").trim();
    if (!hook) {
      return;
    }
    if (
      hook.startsWith("http:request-")
      && String(payload?.path || "").trim().startsWith("/api/plugins/hook-explorer")
    ) {
      return;
    }
    sequence += 1;
    hookCounts.set(hook, Number(hookCounts.get(hook) || 0) + 1);
    const event = {
      id: `hook-${Date.now().toString(36)}-${sequence.toString(36)}`,
      at: Date.now(),
      hook,
      subsystem: inferSubsystem(payload),
      summary: normalizeHookSummary(hook, payload),
      payload: sanitizePayload(payload)
    };
    events.push(event);
    if (events.length > normalizedMaxEvents) {
      const overflow = events.length - normalizedMaxEvents;
      events.splice(0, overflow);
      droppedCount += overflow;
    }
  }

  function subscribe(api, hookName = "") {
    const normalized = String(hookName || "").trim();
    if (!normalized || subscribedHooks.has(normalized)) {
      return;
    }
    subscribedHooks.add(normalized);
    api.addHook(normalized, async (payload = {}) => {
      recordHookEvent(normalized, payload);
      return payload;
    });
  }

  function buildStats() {
    const hooks = [...hookCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name, count]) => ({ name, count }));
    return {
      maxEvents: normalizedMaxEvents,
      storedEvents: events.length,
      droppedCount,
      subscribedHooks: [...subscribedHooks].sort((left, right) => left.localeCompare(right)),
      hooks
    };
  }

  function readEvents(query = {}) {
    const sinceTs = normalizeNumber(query?.sinceTs ?? query?.since_ts ?? 0, 0, 0);
    const limit = normalizeNumber(query?.limit ?? 120, 120, 1, 500);
    const hookFilter = sanitizeHookToken(query?.hook ?? query?.hook_name ?? "");
    const subsystemFilter = sanitizeHookToken(query?.subsystem ?? "");
    const contains = String(query?.contains || "").trim().toLowerCase();
    const filtered = events.filter((entry) => {
      if (sinceTs && Number(entry.at || 0) < sinceTs) {
        return false;
      }
      if (hookFilter && !String(entry.hook || "").toLowerCase().includes(hookFilter)) {
        return false;
      }
      if (subsystemFilter && !sanitizeHookToken(entry.subsystem || "").includes(subsystemFilter)) {
        return false;
      }
      if (contains) {
        const haystack = JSON.stringify(entry).toLowerCase();
        if (!haystack.includes(contains)) {
          return false;
        }
      }
      return true;
    });
    const limited = filtered.slice(Math.max(0, filtered.length - limit));
    return {
      totalCount: filtered.length,
      returnedCount: limited.length,
      events: limited
    };
  }

  function clearEvents() {
    const clearedCount = events.length;
    events.splice(0, events.length);
    hookCounts.clear();
    droppedCount = 0;
    sequence = 0;
    return { clearedCount };
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
        data: false,
        capabilities: ["getHookExplorerStats", "readHookExplorerEvents", "clearHookExplorerEvents"],
        hooks: ["*"],
        runtimeContext: ["promptReviewService", "taskFlightRecorder", "coreTransactions"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["brain:list", "brain:generate", "brain:queue-lane"]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      // Hook Explorer — subscribe to hooks
      const hookNames = [
        "http:request-started",
        "http:request-completed",
        "observer:event",
        "permissions:decision",
        "queue:task-dispatch-started",
        "queue:task-processed",
        "queue:batch-started",
        "queue:batch-processed",
        "cron:tick-started",
        "cron:tick-completed",
        "subsystem:intake:triage-started",
        "subsystem:intake:triage-completed",
        "subsystem:intake:triage-failed",
        "subsystem:voice:response-annotated",
        "subsystem:pipeline:collection-build-started",
        "subsystem:pipeline:collection-build-completed",
        "subsystem:pipeline:collection-build-failed",
        "subsystem:projects:pipelines-list-started",
        "subsystem:projects:pipelines-list-completed",
        "subsystem:projects:pipelines-list-failed",
        "subsystem:projects:pipeline-trace-started",
        "subsystem:projects:pipeline-trace-completed",
        "subsystem:projects:pipeline-trace-failed"
      ];
      for (const hookName of hookNames) {
        subscribe(api, hookName);
      }

      // Hook Explorer — UI panel
      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "hook-explorer-panel",
          title: "Hook Explorer",
          description: "Inspect captured hook payloads across all subsystems.",
          fields: [
            {
              id: "limit",
              label: "Limit",
              type: "number",
              min: 1,
              max: 500,
              step: 1,
              defaultValue: 120
            },
            {
              id: "hook",
              label: "Hook Filter",
              type: "text",
              placeholder: "subsystem:projects:request-completed"
            },
            {
              id: "subsystem",
              label: "Subsystem",
              type: "text",
              placeholder: "projects"
            },
            {
              id: "contains",
              label: "Contains Text",
              type: "text",
              placeholder: "/api/projects/"
            },
            {
              id: "since_ts",
              label: "Since Timestamp",
              type: "number",
              min: 0,
              step: 1
            }
          ],
          actions: [
            {
              id: "stats",
              label: "Stats",
              method: "GET",
              endpoint: "/api/plugins/hook-explorer/stats",
              expects: "json"
            },
            {
              id: "events",
              label: "Load Events",
              method: "GET",
              endpoint: "/api/plugins/hook-explorer/events",
              queryFields: ["limit", "hook", "subsystem", "contains", "since_ts"],
              expects: "json"
            },
            {
              id: "clear",
              label: "Clear",
              method: "POST",
              endpoint: "/api/plugins/hook-explorer/clear",
              expects: "json",
              confirm: "Clear captured Hook Explorer events?"
            }
          ]
        });
      }

      // Prompt Review — System subtab
      if (typeof api.registerUiSystemTab === "function") {
        api.registerUiSystemTab({
          id: "prompt-review",
          title: "Prompts",
          order: 18,
          scriptUrl: "/api/plugin-ui/prompt-review/tab.js"
        });
      }

      if (typeof api.registerUiSystemTab === "function") {
        api.registerUiSystemTab({
          id: "brain-tool-workout",
          title: "Brain Tools",
          order: 19,
          scriptUrl: "/api/plugin-ui/brain-tool-workout/tab.js"
        });
      }

      // Flight Recorder — System subtab
      if (typeof api.registerUiSystemTab === "function") {
        api.registerUiSystemTab({
          id: "flight-recorder",
          title: "Flight Recorder",
          order: 85,
          scriptUrl: "/api/plugin-ui/flight-recorder/tab.js"
        });
      }

      // State Lens — System subtab
      if (typeof api.registerUiSystemTab === "function") {
        api.registerUiSystemTab({
          id: "state-browser",
          title: "State Lens",
          order: 90,
          scriptUrl: "/api/plugin-ui/state-browser/tab.js"
        });
      }

      // Capabilities — System subtab, aggregating every plugin's registered tools
      if (typeof api.registerUiSystemTab === "function") {
        api.registerUiSystemTab({
          id: "capabilities",
          title: "Capabilities",
          order: 95,
          scriptUrl: "/api/plugin-ui/capabilities/tab.js"
        });
      }

      // Hook Explorer — capabilities
      api.provideCapability("getHookExplorerStats", () => buildStats());
      api.provideCapability("readHookExplorerEvents", (query) => readEvents(query));
      api.provideCapability("clearHookExplorerEvents", () => clearEvents());
    },
    async registerRoutes({ app, api }) {
      // ── Hook Explorer routes ──────────────────────────────────────────────
      app.get("/api/plugins/hook-explorer/stats", async (_req, res) => {
        try {
          res.json({ ok: true, stats: buildStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read hook explorer stats") });
        }
      });

      app.get("/api/plugins/hook-explorer/events", async (req, res) => {
        try {
          const result = readEvents(req.query || {});
          res.json({ ok: true, ...result, stats: buildStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read hook explorer events") });
        }
      });

      app.post("/api/plugins/hook-explorer/clear", async (_req, res) => {
        try {
          const result = clearEvents();
          res.json({ ok: true, ...result, stats: buildStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to clear hook explorer events") });
        }
      });

      // ── Prompt Review routes ──────────────────────────────────────────────
      app.get("/api/plugins/developer-tools/task-debug", async (req, res) => {
        try {
          const taskId = String(req.query?.taskId || "").trim();
          const limit = normalizeNumber(req.query?.limit || 80, 80, 5, 500);
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const runtime = api.getRuntimeContext();
          const flightRecorder = runtime?.taskFlightRecorder && typeof runtime.taskFlightRecorder === "object"
            ? runtime.taskFlightRecorder
            : null;
          if (!flightRecorder || typeof flightRecorder.buildDebugPacket !== "function") {
            return res.status(503).json({ ok: false, error: "task flight recorder is unavailable" });
          }
          const packet = await flightRecorder.buildDebugPacket(taskId, { limit });
          res.json(packet);
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to build task debug packet") });
        }
      });

      app.get("/api/plugins/developer-tools/harness-eval/recent", async (req, res) => {
        try {
          const limit = normalizeNumber(req.query?.limit || 40, 40, 1, 200);
          const perTaskLimit = normalizeNumber(req.query?.perTaskLimit || 80, 80, 5, 500);
          const runtime = api.getRuntimeContext();
          const flightRecorder = runtime?.taskFlightRecorder && typeof runtime.taskFlightRecorder === "object"
            ? runtime.taskFlightRecorder
            : null;
          if (!flightRecorder || typeof flightRecorder.buildHarnessEvalReport !== "function") {
            return res.status(503).json({ ok: false, error: "harness eval runtime is unavailable" });
          }
          res.json(await flightRecorder.buildHarnessEvalReport({ limit, perTaskLimit }));
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to build harness eval report") });
        }
      });

      app.get("/api/plugins/developer-tools/harness-check/last-run", async (_req, res) => {
        try {
          const report = summarizeHarnessLastRun(await readJsonObject(HARNESS_LAST_RUN_REPORT_PATH));
          if (!report) {
            return res.status(404).json({ ok: false, error: "no harness check report has been written yet" });
          }
          res.json({ ok: true, report });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read harness check report") });
        }
      });

      app.get("/api/plugins/developer-tools/harness-check/history", async (req, res) => {
        try {
          const limit = normalizeNumber(req.query?.limit || 20, 20, 1, 200);
          const rawRecords = await readJsonLineRecords(HARNESS_CHECK_HISTORY_PATH, Math.max(limit, 200));
          const history = rawRecords
            .map((record) => normalizeHarnessHistoryRecord(record))
            .filter(Boolean)
            .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))
            .slice(0, limit);
          res.json({
            ok: true,
            history,
            trend: summarizeHarnessHistory(rawRecords)
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read harness check history") });
        }
      });

      app.get("/api/plugin-ui/prompt-review/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "prompt-review-tab.js"));
      });

      app.get("/api/plugin-ui/brain-tool-workout/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "brain-tool-workout-tab.js"));
      });

      function getBrainToolWorkoutService() {
        // Brain listing/generation is delegated to model-provider-plugin.js's capabilities
        // rather than the Nova-era runtimeContext functions, which nothing in Genesis ever
        // populates.
        const listBrainsCap = api.getCapability("brain:list");
        const generateCap = api.getCapability("brain:generate");
        if (typeof listBrainsCap !== "function" || typeof generateCap !== "function") {
          return null;
        }
        const queueLaneCap = api.getCapability("brain:queue-lane");
        return createBrainToolWorkoutService({
          compactText,
          getBrainQueueLane: typeof queueLaneCap === "function" ? queueLaneCap : null,
          listAvailableBrains: () => listBrainsCap({}),
          readWorkoutHistory: () => readJsonLineRecords(BRAIN_TOOL_WORKOUT_HISTORY_PATH, 2000),
          appendWorkoutHistory: (record) => appendJsonLineRecord(BRAIN_TOOL_WORKOUT_HISTORY_PATH, record),
          runOllamaGenerate: (model, prompt, opts = {}) => generateCap({ ...opts, model, prompt })
        });
      }

      app.get("/api/plugins/developer-tools/brain-tool-workout/brains", async (_req, res) => {
        try {
          const service = getBrainToolWorkoutService();
          if (!service) {
            return res.status(503).json({ ok: false, error: "brain runtime context is unavailable" });
          }
          res.json({
            ok: true,
            brains: await service.listBrains()
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list brains") });
        }
      });

      app.get("/api/plugins/developer-tools/brain-tool-workout/cases", async (_req, res) => {
        try {
          const service = getBrainToolWorkoutService();
          if (!service) {
            return res.status(503).json({ ok: false, error: "brain workout runtime context is unavailable" });
          }
          res.json({ ok: true, ...service.listCases() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list workout cases") });
        }
      });

      app.get("/api/plugins/developer-tools/brain-tool-workout/history", async (req, res) => {
        try {
          const service = getBrainToolWorkoutService();
          if (!service) {
            return res.status(503).json({ ok: false, error: "brain workout runtime context is unavailable" });
          }
          const brainId = String(req.query?.brainId || "").trim();
          const limit = normalizeNumber(req.query?.limit || 20, 20, 1, 200);
          const summary = await service.summarizeHistory({ brainId, limit });
          res.json({
            ok: true,
            history: summary.history,
            trend: summary.trend
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list workout history") });
        }
      });

      app.get("/api/plugins/developer-tools/brain-tool-workout/readiness", async (_req, res) => {
        try {
          const service = getBrainToolWorkoutService();
          if (!service) {
            return res.status(503).json({ ok: false, error: "brain workout runtime context is unavailable" });
          }
          res.json({
            ok: true,
            readiness: await service.summarizeBrainReadiness({ limitPerBrain: 20 })
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to summarize brain readiness") });
        }
      });

      app.post("/api/plugins/developer-tools/brain-tool-workout/run", async (req, res) => {
        try {
          const service = getBrainToolWorkoutService();
          if (!service) {
            return res.status(503).json({ ok: false, error: "brain workout runtime context is unavailable" });
          }
          const brainId = String(req.body?.brainId || "").trim();
          const caseIds = Array.isArray(req.body?.caseIds) ? req.body.caseIds.map((value) => String(value || "").trim()).filter(Boolean) : [];
          const variantIds = Array.isArray(req.body?.variantIds) ? req.body.variantIds.map((value) => String(value || "").trim()).filter(Boolean) : [];
          const timeoutMs = Math.max(5000, Math.min(Number(req.body?.timeoutMs || 45000), 180000));
          if (!brainId) {
            return res.status(400).json({ ok: false, error: "brainId is required" });
          }
          res.json(await service.runWorkout({
            brainId,
            caseIds,
            variantIds: variantIds.length ? variantIds : ["exact_envelope"],
            timeoutMs
          }));
        } catch (error) {
          res.status(Number(error?.status || 500)).json({ ok: false, error: String(error?.message || error || "brain tool workout failed") });
        }
      });

      app.get("/api/prompts/review", async (_req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const promptReviewService = runtime?.promptReviewService && typeof runtime.promptReviewService === "object"
            ? runtime.promptReviewService
            : null;
          if (!promptReviewService || typeof promptReviewService.generateReview !== "function") {
            return res.status(503).json({ ok: false, error: "prompt-review runtime context is unavailable" });
          }

          const observerConfig = api.getObserverConfig?.() || {};
          const selectedMountIds = Array.isArray(observerConfig?.defaults?.mountIds)
            ? observerConfig.defaults.mountIds.map((value) => String(value))
            : [];
          const internetEnabled = observerConfig?.defaults?.internetEnabled !== false;
          const review = await promptReviewService.generateReview({
            internetEnabled,
            selectedMountIds
          });

          res.json({
            ok: true,
            generatedAt: Number(review?.generatedAt || Date.now()),
            entries: Array.isArray(review?.entries) ? review.entries : []
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "prompt review failed") });
        }
      });

      // ── Flight Recorder routes ────────────────────────────────────────────
      app.get("/api/plugin-ui/flight-recorder/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "flight-recorder-tab.js"));
      });

      // ── State Browser routes ──────────────────────────────────────────────
      app.get("/api/plugin-ui/state-browser/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "state-browser-tab.js"));
      });

      app.get("/api/plugin-ui/capabilities/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "capabilities-tab.js"));
      });
    }
  };
}
