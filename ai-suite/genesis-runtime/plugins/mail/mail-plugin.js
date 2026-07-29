/**
 * Plugin Name: Mail
 * Plugin Slug: mail
 * Description: Moves mail routes and mail UI tab into an optional plugin.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMailDomain } from "./lib/mail-domain.js";
import {
  buildMailRegressionSuites,
  runMailInternalRegressionCase
} from "./lib/mail-regression.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireRuntimeFn(runtime = {}, name = "") {
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

export function createMailPlugin(options = {}) {
  const {
    pluginId = "mail",
    pluginName = "Mail",
    description = "Mail routes and tab UI."
  } = options;
  let lastBackgroundPollAt = 0;
  let mailRuntime = null;
  const getMailRuntime = (api) => {
    if (!mailRuntime) {
      const runtime = api.getRuntimeContext();
      const mailDomainContext = runtime?.mailDomainContext && typeof runtime.mailDomainContext === "object"
        ? runtime.mailDomainContext
        : {};
      mailRuntime = createMailDomain({
        ...mailDomainContext,
        pluginManager: {
          runHook: async (...args) => await api.runHook(...args)
        }
      });
      if (typeof api.provideCapability === "function") {
        api.provideCapability("mail.runtime", () => mailRuntime, { priority: 10 });
      }
    }
    return mailRuntime;
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
        data: false,
        tools: [
          "get_mail_status",
          "get_inbox_summary",
          "get_today_inbox_summary",
          "send_mail",
          "move_mail",
          "poll_mailbox",
          "get_mail_watch_rules"
        ],
        capabilities: [
          "mail.runtime",
          "subsystem:classify"
        ],
        hooks: [
          "intake:tool-call",
          "runtime:startup",
          "runtime:tick:cron"
        ],
        runtimeContext: [
          "buildMailStatus",
          "fetchRecentMessagesForAgent",
          "getActiveMailAgent",
          "mailDomainContext",
          "getMailState",
          "getMailWatchRulesState",
          "hasMailCredentials",
          "looksLikeEmailAddress",
          "moveAgentMail",
          "noteInteractiveActivity",
          "pollActiveMailbox",
          "saveMailWatchRulesState",
          "sendAgentMail"
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
      getMailRuntime(api);
      const safePoll = async ({ emitEvents = true, force = false } = {}) => {
        try {
          const runtime = {
            ...api.getRuntimeContext(),
            ...getMailRuntime(api)
          };
          const pollActiveMailbox = requireRuntimeFn(runtime, "pollActiveMailbox");
          if (!pollActiveMailbox || api.isEnabled?.() !== true) {
            return;
          }
          const observerConfig = api.getObserverConfig?.() || {};
          if (observerConfig?.mail?.enabled !== true) {
            return;
          }
          const intervalMs = Math.max(5000, Number(observerConfig?.mail?.pollIntervalMs || 30000));
          if (!force && Date.now() - Number(lastBackgroundPollAt || 0) < intervalMs) {
            return;
          }
          await pollActiveMailbox({ emitEvents });
          lastBackgroundPollAt = Date.now();
        } catch {
          // Mail poll errors are surfaced by the domain itself.
        }
      };

      if (typeof api.provideCapability === "function") {
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/mail/") || pathname.startsWith("/api/plugin-ui/mail/")) {
            next.add("mail");
          }
          return [...next];
        });
      }
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "mail",
          title: "Mail",
          icon: "M",
          order: 24,
          scriptUrl: "/api/plugin-ui/mail/tab.js"
        });
      }
      if (typeof api.registerUiSecretsTab === "function") {
        api.registerUiSecretsTab({
          id: "mail-secrets",
          title: "Mail",
          order: 20,
          scriptUrl: "/api/plugin-ui/mail/secrets-tab.js"
        });
      }
      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "get_mail_status", description: "Get mailbox availability and last mail check status.", scopes: ["intake"], risk: "normal" });
        api.registerTool({ name: "get_inbox_summary", description: "Get a summary of current non-spam inbox emails.", scopes: ["intake"], risk: "normal" });
        api.registerTool({ name: "get_today_inbox_summary", description: "Get a summary of today's non-spam inbox emails.", scopes: ["intake"], risk: "normal" });
        api.registerTool({ name: "send_mail", description: "Send an email to a direct address using toEmail, plus subject and text.", scopes: ["intake", "worker"], risk: "high", parameters: { toEmail: "string", subject: "string", text: "string" } });
        api.registerTool({ name: "move_mail", description: "Move a recent inbox email to trash or archive using destination plus one of messageId, uid, subjectContains, fromContains, or latest.", scopes: ["intake", "worker"], risk: "high", parameters: { destination: "string", messageId: "string", uid: "number", subjectContains: "string", fromContains: "string", latest: "boolean" } });
        api.registerTool({ name: "poll_mailbox", description: "Force an immediate mailbox poll to check for new emails right now.", scopes: ["intake"], risk: "normal" });
        api.registerTool({ name: "get_mail_watch_rules", description: "List current standing mail watch rules, including saved trash, archive, and forward instructions.", scopes: ["intake"], risk: "normal" });
      }
      if (typeof api.addHook === "function") {
        api.addHook("intake:tools:list", async (payload = {}) => {
          const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
          tools.push(
            {
              name: "poll_mailbox",
              description: "Force an immediate mailbox poll to check for new emails right now."
            },
            {
              name: "get_mail_watch_rules",
              description: "List current standing mail watch rules — the automatic trash, archive, and forward instructions saved from past decisions."
            }
          );
          return { ...payload, tools };
        });

        api.addHook("intake:tool-call", async (payload = {}) => {
          const name = String(payload?.name || "").trim();
          const handledResult = (result = null) => ({ ...payload, handled: true, result });

          if (name === "poll_mailbox") {
            await safePoll({ emitEvents: true, force: true });
            const runtime = { ...api.getRuntimeContext(), ...getMailRuntime(api) };
            const getMailState = requireRuntimeFn(runtime, "getMailState");
            const mailState = getMailState ? getMailState() : {};
            const recentCount = Array.isArray(mailState?.recentMessages) ? mailState.recentMessages.length : 0;
            return handledResult({
              text: `Mailbox polled. ${recentCount} message${recentCount === 1 ? "" : "s"} currently cached.`
            });
          }

          if (name === "get_mail_watch_rules") {
            const runtime = { ...api.getRuntimeContext(), ...getMailRuntime(api) };
            const getMailWatchRulesState = requireRuntimeFn(runtime, "getMailWatchRulesState");
            const rulesState = getMailWatchRulesState ? getMailWatchRulesState() : {};
            const rules = Array.isArray(rulesState?.rules)
              ? rulesState.rules.filter((rule) => rule?.enabled !== false)
              : [];
            if (!rules.length) {
              return handledResult({ text: "No mail watch rules are currently saved.", rules: [] });
            }
            const lines = [`${rules.length} active mail watch rule${rules.length === 1 ? "" : "s"}:`];
            for (const rule of rules.slice(0, 10)) {
              const instruction = String(rule.instruction || rule.id || "").trim();
              const action = String(rule.action || "").trim();
              lines.push(`- ${instruction}${action ? ` → ${action}` : ""}`);
            }
            return handledResult({ text: lines.join("\n"), rules });
          }

          return payload;
        });

        api.addHook("runtime:startup", async (payload = {}) => {
          await safePoll({ emitEvents: false, force: true });
          return payload;
        });
        api.addHook("runtime:tick:cron", async (payload = {}) => {
          await safePoll({ emitEvents: true, force: false });
          return payload;
        });
      }
      if (typeof api.registerRegressionSuite === "function") {
        api.registerRegressionSuite(() => buildMailRegressionSuites());
      }
      if (typeof api.registerInternalRegressionRunner === "function") {
        api.registerInternalRegressionRunner("mail_command_trust", async (testCase = {}, context = {}) =>
          await runMailInternalRegressionCase(testCase, context)
        );
      }
    },
    async registerRoutes({ app, api }) {
      const getRouteRuntime = () => ({
        ...api.getRuntimeContext(),
        ...getMailRuntime(api)
      });

      app.get("/api/plugin-ui/mail/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "mail-tab.js"));
      });

      app.get("/api/plugin-ui/mail/secrets-tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "mail-secrets-tab.js"));
      });

      app.get("/api/mail/status", async (_req, res) => {
        try {
          const runtime = getRouteRuntime();
          const getActiveMailAgent = requireRuntimeFn(runtime, "getActiveMailAgent");
          const hasImapCredentials = requireRuntimeFn(runtime, "hasImapCredentials");
          const fetchRecentMessagesForAgent = requireRuntimeFn(runtime, "fetchRecentMessagesForAgent");
          const buildMailStatus = requireRuntimeFn(runtime, "buildMailStatus");
          const getMailState = requireRuntimeFn(runtime, "getMailState");
          if (!getActiveMailAgent || !hasImapCredentials || !fetchRecentMessagesForAgent || !buildMailStatus || !getMailState) {
            return res.status(503).json({ ok: false, error: "mail runtime context is unavailable" });
          }
          const activeAgent = getActiveMailAgent();
          const mailState = getMailState() || {};
          const highestUidByAgent = mailState?.highestUidByAgent && typeof mailState.highestUidByAgent === "object"
            ? mailState.highestUidByAgent
            : {};
          if (await hasImapCredentials(activeAgent) && !highestUidByAgent[activeAgent?.id]) {
            await fetchRecentMessagesForAgent(activeAgent, { limit: 10, initializeOnly: true });
          }
          const status = await buildMailStatus(activeAgent);
          const messages = Array.isArray(mailState?.recentMessages)
            ? mailState.recentMessages
                .filter((entry) => entry.agentId === activeAgent?.id)
                .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0))
                .slice(0, 12)
            : [];
          res.json({
            ok: true,
            ...status,
            messages
          });
        } catch (error) {
          const runtime = getRouteRuntime();
          const buildMailStatus = requireRuntimeFn(runtime, "buildMailStatus");
          const fallback = buildMailStatus ? await buildMailStatus() : {};
          res.status(500).json({ ok: false, error: String(error?.message || error || "mail status failed"), ...fallback });
        }
      });

      app.post("/api/mail/poll", async (_req, res) => {
        try {
          const runtime = getRouteRuntime();
          const pollActiveMailbox = requireRuntimeFn(runtime, "pollActiveMailbox");
          const noteInteractiveActivity = requireRuntimeFn(runtime, "noteInteractiveActivity");
          if (!pollActiveMailbox) {
            return res.status(503).json({ ok: false, error: "mail runtime context is unavailable" });
          }
          if (noteInteractiveActivity) {
            noteInteractiveActivity();
          }
          const messages = await pollActiveMailbox({ emitEvents: true });
          res.json({ ok: true, count: messages.length, messages });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "mail poll failed") });
        }
      });

      app.post("/api/mail/send", async (req, res) => {
        const runtime = getRouteRuntime();
        const looksLikeEmailAddress = requireRuntimeFn(runtime, "looksLikeEmailAddress");
        const sendAgentMail = requireRuntimeFn(runtime, "sendAgentMail");
        const noteInteractiveActivity = requireRuntimeFn(runtime, "noteInteractiveActivity");
        const toEmail = String(req.body?.toEmail || req.body?.email || req.body?.to || "").trim();
        const subject = String(req.body?.subject || "").trim();
        const text = String(req.body?.text || "").trim();
        if (!looksLikeEmailAddress || !sendAgentMail) {
          return res.status(503).json({ ok: false, error: "mail runtime context is unavailable" });
        }
        if (!looksLikeEmailAddress(toEmail) || !text) {
          return res.status(400).json({ ok: false, error: "toEmail and text are required" });
        }
        try {
          if (noteInteractiveActivity) {
            noteInteractiveActivity();
          }
          const result = await sendAgentMail({ toEmail, subject, text });
          res.json({ ok: true, result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "mail send failed") });
        }
      });

      app.post("/api/mail/move", async (req, res) => {
        const runtime = getRouteRuntime();
        const moveAgentMail = requireRuntimeFn(runtime, "moveAgentMail");
        const noteInteractiveActivity = requireRuntimeFn(runtime, "noteInteractiveActivity");
        const destination = String(req.body?.destination || req.body?.action || "").trim().toLowerCase();
        const messageId = String(req.body?.messageId || req.body?.id || "").trim();
        const uid = Number(req.body?.uid || 0);
        const subjectContains = String(req.body?.subjectContains || req.body?.subject || "").trim();
        const fromContains = String(req.body?.fromContains || req.body?.from || req.body?.sender || "").trim();
        const latest = req.body?.latest === true || String(req.body?.latest || "").trim().toLowerCase() === "true";
        if (!moveAgentMail) {
          return res.status(503).json({ ok: false, error: "mail runtime context is unavailable" });
        }
        if (!destination) {
          return res.status(400).json({ ok: false, error: "destination is required" });
        }
        if (!messageId && !(uid > 0) && !subjectContains && !fromContains && !latest) {
          return res.status(400).json({ ok: false, error: "one of messageId, uid, subjectContains, fromContains, or latest is required" });
        }
        try {
          if (noteInteractiveActivity) {
            noteInteractiveActivity();
          }
          const result = await moveAgentMail({
            destination,
            messageId,
            uid,
            subjectContains,
            fromContains,
            latest
          });
          res.json({ ok: true, result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "mail move failed") });
        }
      });

      app.post("/api/mail/summary-setting", async (req, res) => {
        try {
          const runtime = getRouteRuntime();
          const getMailWatchRulesState = requireRuntimeFn(runtime, "getMailWatchRulesState");
          const saveMailWatchRulesState = requireRuntimeFn(runtime, "saveMailWatchRulesState");
          const noteInteractiveActivity = requireRuntimeFn(runtime, "noteInteractiveActivity");
          if (!getMailWatchRulesState || !saveMailWatchRulesState) {
            return res.status(503).json({ ok: false, error: "mail runtime context is unavailable" });
          }
          if (noteInteractiveActivity) {
            noteInteractiveActivity();
          }
          const enabled = req.body?.enabled !== false;
          const rulesState = getMailWatchRulesState();
          rulesState.sendSummariesEnabled = enabled;
          if (Array.isArray(rulesState.rules)) {
            rulesState.rules = rulesState.rules.map((rule) => ({
              ...rule,
              sendSummaries: enabled
            }));
          }
          await saveMailWatchRulesState();
          res.json({ ok: true, sendSummariesEnabled: enabled });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "mail summary update failed") });
        }
      });
    }
  };
}
