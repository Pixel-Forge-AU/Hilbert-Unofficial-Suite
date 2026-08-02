/**
 * Plugin Name: Security
 * Plugin Slug: security
 * Description: Tool orchestration, permission rules, and cron hardening combined into a single security plugin.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { compactText } from "../observer-general-utils.js";

// ---------------------------------------------------------------------------
// Tool Orchestration
// ---------------------------------------------------------------------------

const READ_ONLY_TOOL_NAMES = new Set([
  "inspect_skill_library",
  "list_files",
  "list_installed_skills",
  "list_wordpress_sites",
  "read_document",
  "read_file",
  "read_pdf",
  "search_skill_library",
  "web_fetch",
  "wordpress_test_connection"
]);

function normalizeToolName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeConcurrency(value = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 8));
}

function isReadOnlyToolCall(toolCall = {}, readOnlyTools = READ_ONLY_TOOL_NAMES) {
  const toolName = normalizeToolName(toolCall?.function?.name || toolCall?.name || "");
  return toolName ? readOnlyTools.has(toolName) : false;
}

const MAX_TOOL_CALLS_PER_BATCH_REQUEST = 12;

function buildToolExecutionBatches({ toolCalls = [] } = {}, readOnlySet = READ_ONLY_TOOL_NAMES, defaultConcurrency = 3) {
  const filtered = Array.isArray(toolCalls) ? toolCalls.filter(Boolean) : [];
  const calls = filtered.slice(0, MAX_TOOL_CALLS_PER_BATCH_REQUEST);
  if (filtered.length > calls.length) {
    console.warn(
      `[genesis] security plugin: dropped ${filtered.length - calls.length} tool call(s) beyond the ${MAX_TOOL_CALLS_PER_BATCH_REQUEST}-per-request limit`
    );
  }
  if (!calls.length) {
    return [];
  }
  const batches = [];
  for (const toolCall of calls) {
    const readOnly = isReadOnlyToolCall(toolCall, readOnlySet);
    const previousBatch = batches[batches.length - 1];
    if (readOnly && previousBatch && previousBatch.mode === "parallel") {
      previousBatch.toolCalls.push(toolCall);
      continue;
    }
    if (readOnly) {
      batches.push({ mode: "parallel", concurrency: defaultConcurrency, toolCalls: [toolCall] });
      continue;
    }
    batches.push({ mode: "serial", concurrency: 1, toolCalls: [toolCall] });
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Permission Rules
// ---------------------------------------------------------------------------

function stableSerialize(value = null) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashText(value = "") {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildApprovalKey({ ruleId = "", toolName = "", args = {} } = {}) {
  const normalizedRuleId = String(ruleId || "default").trim().toLowerCase() || "default";
  const normalizedToolName = String(toolName || "unknown").trim().toLowerCase() || "unknown";
  const argsHash = hashText(stableSerialize(args));
  return `${normalizedRuleId}:${normalizedToolName}:${argsHash}`;
}

function buildApprovalMetadata({ behavior = "allow", ruleId = "", toolName = "", reason = "", args = {} } = {}) {
  const normalizedBehavior = normalizeRuleBehavior(behavior, "allow");
  if (normalizedBehavior !== "ask") {
    return null;
  }
  const normalizedToolName = String(toolName || "").trim().toLowerCase();
  const normalizedRuleId = String(ruleId || "").trim();
  const command = compactText(String(args.command || "").trim(), 240);
  const path = compactText(String(args.path || args.file || args.filePath || "").trim(), 200);
  const url = compactText(String(args.url || "").trim(), 200);
  const argPreview = compactText(stableSerialize(args), 420);
  const summaryLines = [
    `Tool: ${normalizedToolName || "(unknown tool)"}`,
    command ? `Requested command: ${command}` : "",
    path ? `Target path: ${path}` : "",
    url ? `Target URL: ${url}` : "",
    reason ? `Reason: ${compactText(String(reason || "").trim(), 220)}` : ""
  ].filter(Boolean);
  return {
    required: true,
    key: buildApprovalKey({ ruleId: normalizedRuleId || "default", toolName: normalizedToolName || "unknown", args }),
    scopeKey: `${normalizedRuleId || "default"}:${normalizedToolName || "unknown"}`,
    ruleId: normalizedRuleId,
    toolName: normalizedToolName,
    reason: compactText(String(reason || "").trim(), 220),
    summary: compactText(summaryLines.join(" | "), 360),
    argPreview,
    command,
    path,
    url
  };
}

function normalizeRuleBehavior(value = "", fallback = "allow") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["allow", "ask", "deny"].includes(normalized) ? normalized : fallback;
}

function normalizeRuleTool(value = "") {
  const normalized = String(value || "*").trim().toLowerCase();
  return normalized || "*";
}

function normalizeRule(rule = {}, index = 0) {
  return {
    id: String(rule.id || `rule-${index + 1}`).trim() || `rule-${index + 1}`,
    tool: normalizeRuleTool(rule.tool),
    behavior: normalizeRuleBehavior(rule.behavior, "allow"),
    reason: compactText(rule.reason || "", 220),
    when: {
      commandRegex: compactText(rule?.when?.commandRegex || "", 240),
      pathRegex: compactText(rule?.when?.pathRegex || "", 240),
      urlRegex: compactText(rule?.when?.urlRegex || "", 240),
      argIncludes: compactText(rule?.when?.argIncludes || "", 160)
    }
  };
}

function normalizeRuleSet(ruleset = {}) {
  const rules = Array.isArray(ruleset.rules)
    ? ruleset.rules.map((rule, index) => normalizeRule(rule, index)).filter(Boolean)
    : [];
  return {
    version: Number(ruleset.version || 1),
    defaultBehavior: normalizeRuleBehavior(ruleset.defaultBehavior, "allow"),
    rules
  };
}

function buildDefaultRuleSet() {
  return normalizeRuleSet({
    version: 1,
    defaultBehavior: "allow",
    rules: [
      {
        id: "deny-install-skill",
        tool: "install_skill",
        behavior: "deny",
        reason: "install_skill is always user-approved only"
      },
      {
        id: "ask-shell-destructive",
        tool: "shell_command",
        behavior: "ask",
        reason: "Potentially destructive shell operation requires explicit user approval",
        when: {
          commandRegex: "\\b(rm\\s+-rf|mkfs\\.|dd\\s+if=|shutdown\\b|reboot\\b|poweroff\\b|format\\s+|fdisk\\b)\\b"
        }
      }
    ]
  });
}

function safeRegexMatch(pattern = "", text = "") {
  const source = String(pattern || "").trim();
  if (!source) return false;
  try {
    return new RegExp(source, "i").test(String(text || ""));
  } catch {
    return false;
  }
}

function ruleMatchesInvocation(rule = {}, invocation = {}) {
  const toolName = String(invocation.toolName || "").trim().toLowerCase();
  const args = invocation.args && typeof invocation.args === "object" ? invocation.args : {};
  const serializedArgs = JSON.stringify(args);
  const command = String(args.command || "").trim();
  const path = String(args.path || args.file || args.filePath || "").trim();
  const url = String(args.url || "").trim();

  if (rule.tool !== "*" && rule.tool !== toolName) return false;
  const when = rule.when && typeof rule.when === "object" ? rule.when : {};
  if (when.commandRegex && !safeRegexMatch(when.commandRegex, command)) return false;
  if (when.pathRegex && !safeRegexMatch(when.pathRegex, path)) return false;
  if (when.urlRegex && !safeRegexMatch(when.urlRegex, url)) return false;
  if (when.argIncludes) {
    const needle = String(when.argIncludes || "").trim().toLowerCase();
    if (needle && !serializedArgs.toLowerCase().includes(needle)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cron Hardening
// ---------------------------------------------------------------------------

function normalizeNumber(value = 0, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function waitMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs || 0))));
}

async function readLockFile(fs, lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function acquireLock(fs, lockPath, staleMs) {
  const now = Date.now();
  try {
    const payload = { pid: process.pid, acquiredAt: now };
    await fs.writeFile(lockPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") return false;
    const existing = await readLockFile(fs, lockPath);
    const acquiredAt = Number(existing?.acquiredAt || 0);
    if (!acquiredAt || now - acquiredAt > staleMs) {
      try {
        await fs.rm(lockPath, { force: true });
        const payload = { pid: process.pid, acquiredAt: now };
        await fs.writeFile(lockPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Combined plugin export
// ---------------------------------------------------------------------------

export function createSecurityPlugin(options = {}) {
  const {
    pluginId = "security",
    pluginName = "Security",
    description = "Tool orchestration, permission rules, and cron hardening.",
    permissionsDataKey = "permission-rules",
    maxParallelReadOnly = 3,
    readOnlyTools = READ_ONLY_TOOL_NAMES,
    staleLockMs = 90_000,
    minTickGapMs = 5_000,
    jitterMs = 750,
    lockDataKey = "cron-tick"
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
          "buildToolExecutionBatches",
          "isReadOnlyToolCall",
          "evaluateToolPermission",
          "readPermissionRules",
          "writePermissionRules",
          "wrapCronTick",
          "getCronHardeningStatus"
        ],
        // Note: this plugin does NOT itself hook into tool-call enforcement (no api.addHook
        // call here) -- it only exposes evaluateToolPermission/etc. as pull-based capabilities
        // for another plugin to call. Real automatic enforcement of the "permissions:decision"
        // hook lives in governance-plugin.js.
        hooks: [],
        runtimeContext: ["fs", "path"]
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
      // --- Tool orchestration ---
      const readOnlySet = new Set([...readOnlyTools].map((entry) => normalizeToolName(entry)).filter(Boolean));
      const defaultConcurrency = normalizeConcurrency(maxParallelReadOnly);

      api.provideCapability("buildToolExecutionBatches", (args) =>
        buildToolExecutionBatches(args, readOnlySet, defaultConcurrency)
      );
      api.provideCapability("isReadOnlyToolCall", ({ toolCall } = {}) =>
        isReadOnlyToolCall(toolCall, readOnlySet)
      );

      // --- Permission rules ---
      if (api.data) {
        async function readRules() {
          const fallback = buildDefaultRuleSet();
          const saved = await api.data.readJson(permissionsDataKey, null);
          if (!saved || typeof saved !== "object") {
            await api.data.writeJson(permissionsDataKey, fallback);
            return fallback;
          }
          return normalizeRuleSet(saved);
        }

        async function writeRules(nextRules = {}) {
          const normalized = normalizeRuleSet(nextRules);
          await api.data.writeJson(permissionsDataKey, normalized);
          return normalized;
        }

        async function evaluateToolPermission(invocation = {}) {
          const normalizedInvocation = {
            toolName: String(invocation.toolName || "").trim().toLowerCase(),
            args: invocation.args && typeof invocation.args === "object" ? invocation.args : {}
          };
          const ruleset = await readRules();
          const match = ruleset.rules.find((rule) => ruleMatchesInvocation(rule, normalizedInvocation));
          if (!match) {
            const defaultDecision = {
              behavior: ruleset.defaultBehavior,
              reason: ruleset.defaultBehavior === "allow" ? "no matching permission rule" : "default permission behavior",
              ruleId: ""
            };
            const approval = buildApprovalMetadata({
              behavior: defaultDecision.behavior,
              ruleId: defaultDecision.ruleId,
              toolName: normalizedInvocation.toolName,
              reason: defaultDecision.reason,
              args: normalizedInvocation.args
            });
            if (approval) defaultDecision.approval = approval;
            return defaultDecision;
          }
          const decision = {
            behavior: match.behavior,
            reason: match.reason || `matched permission rule ${match.id}`,
            ruleId: match.id
          };
          const approval = buildApprovalMetadata({
            behavior: decision.behavior,
            ruleId: decision.ruleId,
            toolName: normalizedInvocation.toolName,
            reason: decision.reason,
            args: normalizedInvocation.args
          });
          if (approval) decision.approval = approval;
          return decision;
        }

        api.provideCapability("evaluateToolPermission", evaluateToolPermission);
        api.provideCapability("readPermissionRules", readRules);
        api.provideCapability("writePermissionRules", writeRules);
      }

      // --- Permission rules UI panel ---
      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "security-permission-rules",
          title: "Permission Rules Evaluator",
          description: "Evaluate allow/ask/deny decisions for a tool invocation.",
          fields: [
            { id: "tool_name", label: "Tool Name", type: "text", placeholder: "shell_command", required: true },
            { id: "args_json", label: "Args (JSON)", type: "textarea", placeholder: "{\"command\":\"rm -rf /tmp/example\"}", format: "json", defaultValue: "{}" }
          ],
          actions: [
            { id: "evaluate", label: "Evaluate", method: "POST", endpoint: "/api/plugins/security/permissions/evaluate", bodyFields: ["tool_name", "args_json"], staticBody: {}, expects: "json" },
            { id: "read_rules", label: "Read Rules", method: "GET", endpoint: "/api/plugins/security/permissions/rules", expects: "json" }
          ]
        });
      }

      // --- Cron hardening ---
      const runtime = api.getRuntimeContext();
      const fs = runtime?.fs;
      if (fs && api.data && typeof api.data.path === "function") {
        const lockPath = api.data.path(lockDataKey, { extension: ".lock" });
        const normalizedStaleMs = normalizeNumber(staleLockMs, 90_000, 10_000, 15 * 60 * 1000);
        const normalizedMinGapMs = normalizeNumber(minTickGapMs, 5_000, 0, 5 * 60 * 1000);
        const normalizedJitterMs = normalizeNumber(jitterMs, 750, 0, 60_000);
        let lastTickStartedAt = 0;
        let lastSkipReason = "";

        async function withCronLock(runTick = null) {
          if (typeof runTick !== "function") return;
          const lockDir = runtime.path?.dirname?.(lockPath);
          if (lockDir) await fs.mkdir(lockDir, { recursive: true });
          const now = Date.now();
          if (normalizedMinGapMs > 0 && now - lastTickStartedAt < normalizedMinGapMs) {
            lastSkipReason = "min_tick_gap";
            return;
          }
          const acquired = await acquireLock(fs, lockPath, normalizedStaleMs);
          if (!acquired) {
            lastSkipReason = "lock_busy";
            return;
          }
          try {
            if (normalizedJitterMs > 0) {
              const jitterDelay = Math.floor(Math.random() * normalizedJitterMs);
              if (jitterDelay > 0) await waitMs(jitterDelay);
            }
            lastTickStartedAt = Date.now();
            lastSkipReason = "";
            await runTick();
          } finally {
            await fs.rm(lockPath, { force: true }).catch(() => {});
          }
        }

        api.provideCapability("wrapCronTick", (tickFn) => async (...args) =>
          withCronLock(() => tickFn(...args))
        );

        api.provideCapability("getCronHardeningStatus", async () => {
          const lockData = await readLockFile(fs, lockPath);
          return {
            lockPath,
            lockExists: Boolean(lockData),
            lockData: lockData || null,
            staleLockMs: normalizedStaleMs,
            minTickGapMs: normalizedMinGapMs,
            jitterMs: normalizedJitterMs,
            lastTickStartedAt,
            lastSkipReason
          };
        });

        if (typeof api.registerUiPanel === "function") {
          api.registerUiPanel({
            id: "security-cron-status",
            title: "Cron Hardening Status",
            description: "Inspect cron lock, jitter, and minimum-gap state.",
            fields: [],
            actions: [
              { id: "status", label: "Refresh Status", method: "GET", endpoint: "/api/plugins/security/cron/status", expects: "json" }
            ]
          });
        }
      }
    },

    async registerRoutes({ app, api }) {
      app.get("/api/plugins/security/permissions/rules", async (_req, res) => {
        try {
          const reader = api.getCapability("readPermissionRules");
          if (typeof reader !== "function") {
            return res.status(500).json({ ok: false, error: "permission rules capability is unavailable" });
          }
          res.json({ ok: true, rules: await reader() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read rules") });
        }
      });

      app.post("/api/plugins/security/permissions/rules", async (req, res) => {
        try {
          const writer = api.getCapability("writePermissionRules");
          if (typeof writer !== "function") {
            return res.status(500).json({ ok: false, error: "permission rules capability is unavailable" });
          }
          res.json({ ok: true, rules: await writer(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to write rules") });
        }
      });

      app.post("/api/plugins/security/permissions/evaluate", async (req, res) => {
        try {
          const evaluator = api.getCapability("evaluateToolPermission");
          if (typeof evaluator !== "function") {
            return res.status(500).json({ ok: false, error: "permission evaluation capability is unavailable" });
          }
          let normalizedArgs = req.body?.args;
          if (normalizedArgs == null && req.body?.args_json != null) {
            if (typeof req.body.args_json === "string") {
              const rawArgs = String(req.body.args_json || "").trim();
              normalizedArgs = rawArgs ? JSON.parse(rawArgs) : {};
            } else if (typeof req.body.args_json === "object") {
              normalizedArgs = req.body.args_json;
            }
          }
          const decision = await evaluator({ toolName: req.body?.toolName || req.body?.tool_name, args: normalizedArgs });
          res.json({ ok: true, decision });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to evaluate rules") });
        }
      });

      app.get("/api/plugins/security/cron/status", async (_req, res) => {
        try {
          const getStatus = api.getCapability("getCronHardeningStatus");
          if (typeof getStatus !== "function") {
            return res.status(500).json({ ok: false, error: "cron hardening status capability is unavailable" });
          }
          res.json({ ok: true, status: await getStatus() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read cron hardening status") });
        }
      });
    }
  };
}
