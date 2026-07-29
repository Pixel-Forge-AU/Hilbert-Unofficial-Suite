/**
 * Plugin Name: GitHub
 * Plugin Slug: github
 * Description: GitHub notifications, PR/issue context, and action dispatch via the gh CLI.
 *              Polls unread notifications on a cron tick and surfaces them as worker tools.
 *              GitHub user and watched repos are configurable per-install.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createGithubDomain, classifyGithubMailNotification } from "./lib/github-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOOL_DEFINITIONS = [
  {
    name: "github_get_status",
    description: "Get GitHub connection status: authenticated user, watched repos, last poll time, and unread notification count.",
    scopes: ["intake", "worker"],
    risk: "normal",
    parameters: {}
  },
  {
    name: "github_list_notifications",
    description: "List GitHub notifications for the configured user. Optionally filter by repo.",
    scopes: ["intake", "worker"],
    risk: "normal",
    parameters: {
      all: "boolean — include already-read notifications (default false)",
      participating: "boolean — only notifications where the user is participating",
      repoFilter: "string — only show notifications for repos containing this string (e.g. 'my-org/my-repo')"
    }
  },
  {
    name: "github_get_notification",
    description: "Get full details for a single GitHub notification thread, including the linked PR or issue body.",
    scopes: ["intake", "worker"],
    risk: "normal",
    parameters: {
      threadId: "string (required) — notification thread ID from github_list_notifications"
    }
  },
  {
    name: "github_mark_read",
    description: "Mark one or all GitHub notifications as read.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      threadId: "string — thread ID to mark read. Omit to mark ALL notifications as read."
    }
  },
  {
    name: "github_configure",
    description: "Update GitHub plugin configuration: username override, PAT, watched repos, poll interval.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      username: "string — GitHub username (overrides the auto-detected gh auth user)",
      pat: "string — GitHub personal access token. Set to empty string to clear.",
      watchedRepos: "array of string — repo name patterns to filter notifications (e.g. ['my-org', 'my-org/specific-repo']). Empty array = watch all.",
      pollIntervalMinutes: "number — how often to poll for new notifications (default 5)"
    }
  },
  {
    name: "github_comment",
    description: "Add a comment to a GitHub issue or pull request.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      repo: "string (required) — owner/repo e.g. 'my-org/my-repo'",
      issueNumber: "number (required) — issue or PR number",
      body: "string (required) — comment body (markdown supported)"
    }
  },
  {
    name: "github_close_issue",
    description: "Close a GitHub issue.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      repo: "string (required) — owner/repo e.g. 'my-org/my-repo'",
      issueNumber: "number (required) — issue number",
      stateReason: "string — reason for closing: 'completed' or 'not_planned' (optional)"
    }
  },
  {
    name: "github_approve_pr",
    description: "Submit a review on a GitHub pull request: approve, request changes, or leave a comment review.",
    scopes: ["worker"],
    risk: "normal",
    parameters: {
      repo: "string (required) — owner/repo e.g. 'my-org/my-repo'",
      prNumber: "number (required) — pull request number",
      event: "string — 'APPROVE', 'REQUEST_CHANGES', or 'COMMENT' (default 'COMMENT')",
      body: "string — review body text (required for REQUEST_CHANGES, optional otherwise)"
    }
  }
];

function compactGithubPluginText(value = "", maxLength = 1200) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

async function findExistingGithubMailTask(runtime = {}, messageId = "") {
  const id = String(messageId || "").trim();
  if (!id || typeof runtime.listAllTasks !== "function") return null;
  const all = await runtime.listAllTasks().catch(() => null);
  const tasks = [
    ...(Array.isArray(all?.queued) ? all.queued : []),
    ...(Array.isArray(all?.waiting) ? all.waiting : []),
    ...(Array.isArray(all?.inProgress) ? all.inProgress : []),
    ...(Array.isArray(all?.closed) ? all.closed : [])
  ];
  return tasks.find((task) =>
    String(task?.sourceMessageId || "").trim() === id
    && String(task?.internalJobType || "").trim() === "github_mail_notification"
  ) || null;
}

function buildGithubMailTaskMessage(message = {}, notification = {}) {
  const repo = String(notification.repo || "").trim();
  const subject = String(notification.subject || message.subject || "(no subject)").trim() || "(no subject)";
  const preview = compactGithubPluginText(notification.preview || message.text || "", 900);
  return [
    "Triage this GitHub notification email for Derek.",
    "",
    repo ? `Repository: ${repo}` : "",
    notification.url ? `GitHub URL: ${notification.url}` : "",
    notification.reason ? `Notification reason: ${notification.reason}` : "",
    `Email subject: ${subject}`,
    "",
    "Use the GitHub tools to inspect the relevant issue, PR, commit, or notification before deciding what to do.",
    "If it is actionable and safe, do the work or prepare the needed response. If it needs Derek's decision, create or update a todo/waiting item and summarize the blocker. If it is FYI only, archive or mark it handled when appropriate.",
    "",
    preview ? `Email preview: ${preview}` : ""
  ].filter(Boolean).join("\n");
}

async function findExistingGithubNotificationTask(runtime = {}, threadId = "") {
  const id = String(threadId || "").trim();
  if (!id || typeof runtime.listAllTasks !== "function") return null;
  const all = await runtime.listAllTasks().catch(() => null);
  const tasks = [
    ...(Array.isArray(all?.queued) ? all.queued : []),
    ...(Array.isArray(all?.waiting) ? all.waiting : []),
    ...(Array.isArray(all?.inProgress) ? all.inProgress : []),
    ...(Array.isArray(all?.closed) ? all.closed : [])
  ];
  return tasks.find((task) =>
    String(task?.sourceThreadId || "").trim() === id
    && String(task?.internalJobType || "").trim() === "github_api_notification"
  ) || null;
}

function buildGithubNotificationTaskMessage(notification = {}) {
  const repo = String(notification.repo || "").trim();
  const title = String(notification.title || "(no title)").trim() || "(no title)";
  return [
    "Triage this GitHub notification for Derek.",
    "",
    repo ? `Repository: ${repo}` : "",
    notification.subjectUrl ? `GitHub URL: ${notification.subjectUrl}` : "",
    notification.reason ? `Notification reason: ${notification.reason}` : "",
    notification.type ? `Type: ${notification.type}` : "",
    `Title: ${title}`,
    "",
    "Use the GitHub tools (github_get_notification, github_list_notifications) to inspect the relevant issue, PR, commit, or notification before deciding what to do.",
    "If it is actionable and safe, do the work or prepare the needed response. If it needs Derek's decision, create or update a todo/waiting item and summarize the blocker. If it is FYI only, mark it handled when appropriate."
  ].filter(Boolean).join("\n");
}

export function createGithubPlugin(options = {}) {
  const {
    pluginId = "github",
    pluginName = "GitHub",
    description = "GitHub notifications, PR/issue context, and action dispatch."
  } = options;

  let domain = null;
  let lastCronPollAt = 0;

  function getDomain(api) {
    if (!domain) {
      domain = createGithubDomain({ data: api.data });
    }
    return domain;
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
        tools: TOOL_DEFINITIONS.map((t) => t.name),
        capabilities: ["github.notifications"],
        hooks: [
          "intake:tool-call",
          "mail:message-received",
          "runtime:tick:cron"
        ],
        runtimeContext: [
          "createQueuedTask",
          "listAllTasks",
          "getObserverConfig"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.registerUiSecretsTab === "function") {
        api.registerUiSecretsTab({
          id: "github-secrets",
          title: "GitHub",
          order: 35,
          scriptUrl: "/api/plugin-ui/github/secrets-tab.js"
        });
      }

      if (typeof api.addHook === "function") {
        api.addHook("intake:tool-call", async (payload = {}) => {
          const name = String(payload?.name || "").trim();
          const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
          if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

          const d = getDomain(api);
          let result;

          try {
            if (name === "github_get_status") {
              result = await d.getStatus();

            } else if (name === "github_list_notifications") {
              result = await d.listNotifications({
                all: args.all === true,
                participating: args.participating === true,
                repoFilter: String(args.repoFilter || "").trim()
              });

            } else if (name === "github_get_notification") {
              const threadId = String(args.threadId || "").trim();
              if (!threadId) {
                result = { ok: false, error: "threadId is required" };
              } else {
                result = await d.getThread(threadId);
              }

            } else if (name === "github_mark_read") {
              const threadId = String(args.threadId || "").trim();
              result = threadId ? await d.markRead(threadId) : await d.markAllRead();

            } else if (name === "github_configure") {
              const update = {};
              if (typeof args.username === "string") update.username = args.username.trim();
              if (typeof args.pat === "string") update.pat = args.pat;
              if (Array.isArray(args.watchedRepos)) {
                update.watchedRepos = args.watchedRepos.map((r) => String(r || "").trim()).filter(Boolean);
              }
              if (typeof args.pollIntervalMinutes === "number" && args.pollIntervalMinutes > 0) {
                update.pollIntervalMinutes = args.pollIntervalMinutes;
              }
              domain = null;
              const saved = await createGithubDomain({ data: api.data }).saveConfig(update);
              result = { ok: true, config: { ...saved, pat: saved.pat ? "***" : "" } };

            } else if (name === "github_comment") {
              const repo = String(args.repo || "").trim();
              const issueNumber = parseInt(args.issueNumber, 10);
              const body = String(args.body || "").trim();
              if (!repo || !issueNumber || !body) {
                result = { ok: false, error: "repo, issueNumber, and body are required" };
              } else {
                result = await d.addComment(repo, issueNumber, body);
              }

            } else if (name === "github_close_issue") {
              const repo = String(args.repo || "").trim();
              const issueNumber = parseInt(args.issueNumber, 10);
              if (!repo || !issueNumber) {
                result = { ok: false, error: "repo and issueNumber are required" };
              } else {
                result = await d.closeIssue(repo, issueNumber, String(args.stateReason || "").trim());
              }

            } else if (name === "github_approve_pr") {
              const repo = String(args.repo || "").trim();
              const prNumber = parseInt(args.prNumber, 10);
              if (!repo || !prNumber) {
                result = { ok: false, error: "repo and prNumber are required" };
              } else {
                result = await d.submitPrReview(repo, prNumber, String(args.event || "COMMENT"), String(args.body || "").trim());
              }
            }
          } catch (err) {
            result = { ok: false, error: String(err?.message || err) };
          }

          return { ...payload, handled: true, result };
        });

        api.addHook("mail:message-received", async (payload = {}) => {
          if (payload?.initializeOnly === true) return payload;
          const message = payload?.message && typeof payload.message === "object" ? payload.message : null;
          if (!message) return payload;
          if (message?.command?.detected === true) return payload;
          if (message?.triage?.likelySpam === true || message?.triage?.likelyPhishing === true) return payload;

          const notification = classifyGithubMailNotification(message);
          if (!notification.matched) return payload;

          const runtime = api.getRuntimeContext?.() || {};
          const createQueuedTask = typeof runtime.createQueuedTask === "function" ? runtime.createQueuedTask : null;
          if (!createQueuedTask) return {
            ...payload,
            message: {
              ...message,
              github: {
                ...(message.github || {}),
                notification,
                taskQueued: false,
                reason: "createQueuedTask runtime capability is unavailable"
              }
            }
          };

          try {
            const messageId = String(message.id || "").trim();
            const existing = await findExistingGithubMailTask(runtime, messageId);
            if (existing) {
              return {
                ...payload,
                message: {
                  ...message,
                  github: {
                    ...(message.github || {}),
                    notification,
                    taskQueued: true,
                    taskId: existing.id,
                    deduped: true
                  }
                }
              };
            }

            const observerConfig = typeof runtime.getObserverConfig === "function" ? runtime.getObserverConfig() : api.getObserverConfig?.() || {};
            const task = await createQueuedTask({
              message: buildGithubMailTaskMessage(message, notification),
              sessionId: "github:mail",
              requestedBrainId: "worker",
              intakeBrainId: "bitnet",
              internetEnabled: true,
              selectedMountIds: Array.isArray(observerConfig?.defaults?.mountIds) ? observerConfig.defaults.mountIds : [],
              forceToolUse: true,
              requireWorkerPreflight: true,
              notes: `Queued from GitHub notification email: ${compactGithubPluginText(notification.subject || message.subject || "", 180)}`,
              taskMeta: {
                internalJobType: "github_mail_notification",
                sourceKind: "email",
                sourceMessageId: messageId,
                githubNotification: {
                  repo: notification.repo,
                  url: notification.url,
                  reason: notification.reason,
                  sender: notification.sender,
                  subject: notification.subject
                }
              }
            });
            return {
              ...payload,
              message: {
                ...message,
                github: {
                  ...(message.github || {}),
                  notification,
                  taskQueued: true,
                  taskId: task.id,
                  taskCodename: task.codename || "",
                  deduped: false
                }
              }
            };
          } catch (error) {
            return {
              ...payload,
              message: {
                ...message,
                github: {
                  ...(message.github || {}),
                  notification,
                  taskQueued: false,
                  error: String(error?.message || error || "failed to queue GitHub notification task")
                }
              }
            };
          }
        });

        api.addHook("runtime:tick:cron", async (payload = {}) => {
          try {
            const d = getDomain(api);
            const config = await d.readConfig();
            const intervalMs = Number(config.pollIntervalMinutes || 5) * 60 * 1000;
            if (Date.now() - lastCronPollAt < intervalMs) return payload;
            lastCronPollAt = Date.now();

            const pollResult = await d.poll();
            if (!pollResult.ok || !pollResult.newNotifications?.length) return payload;

            const runtime = api.getRuntimeContext?.() || {};
            const createQueuedTask = typeof runtime.createQueuedTask === "function" ? runtime.createQueuedTask : null;
            if (!createQueuedTask) return payload;

            const observerConfig = typeof runtime.getObserverConfig === "function" ? runtime.getObserverConfig() : api.getObserverConfig?.() || {};
            const toQueue = pollResult.newNotifications.slice(0, 5);

            for (const notification of toQueue) {
              try {
                const existing = await findExistingGithubNotificationTask(runtime, notification.id);
                if (existing) continue;
                await createQueuedTask({
                  message: buildGithubNotificationTaskMessage(notification),
                  sessionId: "github:api",
                  requestedBrainId: "worker",
                  intakeBrainId: "bitnet",
                  internetEnabled: true,
                  selectedMountIds: Array.isArray(observerConfig?.defaults?.mountIds) ? observerConfig.defaults.mountIds : [],
                  forceToolUse: true,
                  requireWorkerPreflight: true,
                  notes: `Queued from GitHub API notification: ${compactGithubPluginText(notification.title || "", 180)}`,
                  taskMeta: {
                    internalJobType: "github_api_notification",
                    sourceKind: "github_api",
                    sourceThreadId: notification.id,
                    githubNotification: {
                      repo: notification.repo,
                      url: notification.subjectUrl,
                      reason: notification.reason,
                      type: notification.type,
                      title: notification.title
                    }
                  }
                });
              } catch {
                // non-fatal per notification
              }
            }
          } catch {
            // polling errors are non-fatal
          }
          return payload;
        });
      }
    },

    async registerRoutes({ app, api }) {
      // Serve the secrets/config tab JS
      app.get("/api/plugin-ui/github/secrets-tab.js", (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "github-secrets-tab.js"));
      });

      // Status endpoint (used by secrets tab and workers)
      app.get("/api/github/status", async (_req, res) => {
        try {
          const d = getDomain(api);
          const status = await d.getStatus();
          res.json({ ok: true, ...status });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err) });
        }
      });

      // Get current config (PAT redacted)
      app.get("/api/github/config", async (_req, res) => {
        try {
          const d = getDomain(api);
          const config = await d.readConfig();
          res.json({ ok: true, config: { ...config, pat: config.pat ? "***" : "" } });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err) });
        }
      });

      // Save config from secrets tab
      app.post("/api/github/config", async (req, res) => {
        try {
          const body = req.body && typeof req.body === "object" ? req.body : {};
          const update = {};
          if (typeof body.username === "string") update.username = body.username.trim();
          if (typeof body.pat === "string") update.pat = body.pat;
          if (Array.isArray(body.watchedRepos)) {
            update.watchedRepos = body.watchedRepos.map((r) => String(r || "").trim()).filter(Boolean);
          }
          if (typeof body.pollIntervalMinutes === "number" && body.pollIntervalMinutes > 0) {
            update.pollIntervalMinutes = body.pollIntervalMinutes;
          }
          // Invalidate domain cache so next call picks up new config
          domain = null;
          const saved = await createGithubDomain({ data: api.data }).saveConfig(update);
          res.json({ ok: true, config: { ...saved, pat: saved.pat ? "***" : "" } });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err) });
        }
      });

      // Clear PAT only
      app.post("/api/github/config/clear-pat", async (_req, res) => {
        try {
          domain = null;
          const saved = await createGithubDomain({ data: api.data }).saveConfig({ pat: "" });
          res.json({ ok: true, config: { ...saved, pat: "" } });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err) });
        }
      });
    }
  };
}
