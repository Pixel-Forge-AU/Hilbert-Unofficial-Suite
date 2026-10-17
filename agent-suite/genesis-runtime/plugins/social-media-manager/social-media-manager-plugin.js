/**
 * Plugin Name: Social Media Manager
 * Plugin Slug: social-media-manager
 * Description: Manages product promotion research, social post drafts, comment replies, interaction tracking, and campaign reports.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSocialMediaManagerDomain } from "./lib/social-media-manager-domain.js";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


function handled(payload = {}, result = null) {
  return { ...payload, handled: true, result };
}

function normalizeSessionId(service = "", accountId = "") {
  return `${String(service || "web").trim().toLowerCase() || "web"}:${String(accountId || "default").trim().toLowerCase() || "default"}`;
}

function requireCapability(api, name = "") {
  const capability = api.getCapability(name);
  if (typeof capability !== "function") {
    throw new Error(`${name} capability is unavailable`);
  }
  return capability;
}

async function getCurrentBrowserUrl(api, { service = "", accountId = "" } = {}) {
  const browserDaemon = api.getCapability("browser.daemon");
  if (typeof browserDaemon !== "function") {
    return "";
  }
  const daemon = browserDaemon();
  return await daemon.currentUrl({ sessionId: normalizeSessionId(service, accountId) }).catch(() => "");
}

async function extractComments(api, { service = "", accountId = "", target = {}, post = {}, fallbackText = "" } = {}) {
  const browserDaemon = api.getCapability("browser.daemon");
  if (typeof browserDaemon !== "function") {
    return [];
  }
  const daemon = browserDaemon();
  const sessionId = normalizeSessionId(service, accountId);
  const commentSelector = String(target.commentSelector || "").trim();
  const authorSelector = String(target.commentAuthorSelector || "").trim();
  const textSelector = String(target.commentTextSelector || "").trim();
  if (commentSelector) {
    const expression = `
      const commentSelector = ${JSON.stringify(commentSelector)};
      const authorSelector = ${JSON.stringify(authorSelector)};
      const textSelector = ${JSON.stringify(textSelector)};
      return Array.from(document.querySelectorAll(commentSelector)).slice(0, 50).map((node, index) => {
        const authorNode = authorSelector ? node.querySelector(authorSelector) : null;
        const textNode = textSelector ? node.querySelector(textSelector) : node;
        return {
          id: node.getAttribute("data-id") || node.id || String(index),
          author: (authorNode?.innerText || authorNode?.textContent || "").trim(),
          text: (textNode?.innerText || textNode?.textContent || "").trim(),
          externalUrl: location.href
        };
      }).filter((entry) => entry.text);
    `;
    const result = await daemon.evaluateJs(expression, { sessionId }).catch(() => null);
    if (Array.isArray(result?.result)) {
      return result.result;
    }
  }
  const text = fallbackText || await daemon.getText(String(target.monitorTextSelector || "body").trim(), { sessionId }).catch(() => "");
  return String(text || "")
    .split(/\n{2,}/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 20 && /[?!.]/.test(entry))
    .slice(0, 12)
    .map((entry, index) => ({
      id: `${post.id || "post"}-observed-${index}`,
      author: "",
      text: entry,
      externalUrl: post.publishedUrl || ""
    }));
}

export function createSocialMediaManagerPlugin(options = {}) {
  const {
    pluginId = "social-media-manager",
    pluginName = "Social Media Manager",
    description = "Product promotion research, social content drafting, comment reply tracking, and reporting."
  } = options;

  let domain = null;
  const getDomain = (api) => {
    if (!domain) {
      domain = createSocialMediaManagerDomain({
        dataApi: api.data,
        broadcast: (event) => api.broadcast(event)
      });
    }
    return domain;
  };

  const tools = [
    {
      name: "social_save_product",
      description: "Save a product to advertise, including audience, value proposition, URL, keywords, and constraints.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { id: "string", name: "string", url: "string", description: "string", audience: "string", valueProposition: "string", keywords: "array|string", constraints: "string" }
    },
    {
      name: "social_find_posting_opportunities",
      description: "Find and score places to post online for a saved or supplied product. Returns research URLs and posting guidance.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { productId: "string", product: "object|string", platforms: "array|string", keywords: "array|string", candidateUrls: "array|string", saveProduct: "boolean" }
    },
    {
      name: "social_compose_posts",
      description: "Create platform-aware useful draft posts for a product and optional opportunity, tailored for the target audience.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { productId: "string", product: "string", opportunityId: "string", platform: "string", tone: "string", count: "number", callToAction: "string" }
    },
    {
      name: "social_save_publishing_target",
      description: "Save a reusable browser publishing target with composer URL and selectors for posting/monitoring.",
      scopes: ["worker"],
      risk: "high",
      parameters: { platform: "string", accountId: "string", label: "string", composerUrl: "string", bodySelector: "string", titleSelector: "string", submitSelector: "string", monitorTextSelector: "string", commentSelector: "string", commentAuthorSelector: "string", commentTextSelector: "string" }
    },
    {
      name: "social_update_post",
      description: "Update a social post draft/status, published URL, schedule, or metrics.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { postId: "string", status: "draft|approved|published|archived", publishedUrl: "string", scheduledAt: "ISO datetime", metrics: "object", title: "string", body: "string" }
    },
    {
      name: "social_record_interaction",
      description: "Record a comment/reply interaction and generate a suggested response for review.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { postId: "string", productId: "string", platform: "string", author: "string", text: "string", externalUrl: "string", sentiment: "positive|neutral|negative|question" }
    },
    {
      name: "social_update_interaction",
      description: "Update a tracked interaction reply draft or mark it approved, replied, ignored, or needing review.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { interactionId: "string", replyDraft: "string", replyStatus: "needs-review|approved|replied|ignored" }
    },
    {
      name: "social_get_report",
      description: "Get a campaign report covering products, opportunities, drafts, published posts, interactions, pending replies, and metrics.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { productId: "string", product: "string" }
    },
    {
      name: "social_list_browser_accounts",
      description: "List reusable browser website accounts that the social media manager can use for posting and monitoring.",
      scopes: ["intake", "worker"],
      risk: "normal",
      parameters: { service: "string" }
    },
    {
      name: "social_publish_post_browser",
      description: "Publish a drafted social post through a configured browser account using selectors for the target site's composer.",
      scopes: ["worker"],
      risk: "high",
      parameters: { postId: "string", service: "string", accountId: "string", url: "string", bodySelector: "string", titleSelector: "string", submitSelector: "string", requiresApproval: "boolean" }
    },
    {
      name: "social_monitor_post_browser",
      description: "Open a published social post with a configured browser account and return page text/metrics for comment monitoring.",
      scopes: ["worker"],
      risk: "normal",
      parameters: { postId: "string", service: "string", accountId: "string", url: "string", textSelector: "string" }
    },
    {
      name: "social_publish_post",
      description: "Publish a drafted social post using a saved publishing target and browser account session.",
      scopes: ["worker"],
      risk: "high",
      parameters: { postId: "string", targetId: "string", platform: "string", accountId: "string", requiresApproval: "boolean" }
    },
    {
      name: "social_monitor_posts",
      description: "Monitor one or more published posts through saved publishing targets, extract comments, dedupe them, draft replies, and update metrics.",
      scopes: ["worker"],
      risk: "normal",
      parameters: { postId: "string", targetId: "string", platform: "string", accountId: "string", limit: "number" }
    }
  ];

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
          "socialMedia.listState",
          "socialMedia.saveProduct",
          "socialMedia.discoverOpportunities",
          "socialMedia.composePosts",
          "socialMedia.savePublishingTarget",
          "socialMedia.findPublishingTarget",
          "socialMedia.updatePost",
          "socialMedia.recordInteraction",
          "socialMedia.recordMonitorSnapshot",
          "socialMedia.updateInteraction",
          "socialMedia.buildReport"
        ],
        hooks: [
          "intake:tools:list",
          "intake:tool-call"
        ],
        runtimeContext: ["noteInteractiveActivity"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: [
          "browser.accounts.list",
          "browser.externalAction",
          "browser.daemon",
          "browser.session.open",
          "browser.session.verify"
        ]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      if (!api.data) {
        return;
      }
      const social = getDomain(api);
      if (typeof api.provideCapability === "function") {
        api.provideCapability("socialMedia.listState", () => social.listState());
        api.provideCapability("socialMedia.saveProduct", (input = {}) => social.saveProduct(input));
        api.provideCapability("socialMedia.discoverOpportunities", (input = {}) => social.discoverOpportunities(input));
        api.provideCapability("socialMedia.composePosts", (input = {}) => social.composePosts(input));
        api.provideCapability("socialMedia.savePublishingTarget", (input = {}) => social.savePublishingTarget(input));
        api.provideCapability("socialMedia.findPublishingTarget", (input = {}) => social.findPublishingTarget(input));
        api.provideCapability("socialMedia.updatePost", (postId = "", patch = {}) => social.updatePost(postId, patch));
        api.provideCapability("socialMedia.recordInteraction", (input = {}) => social.recordInteraction(input));
        api.provideCapability("socialMedia.recordMonitorSnapshot", (input = {}) => social.recordMonitorSnapshot(input));
        api.provideCapability("socialMedia.updateInteraction", (interactionId = "", patch = {}) => social.updateInteraction(interactionId, patch));
        api.provideCapability("socialMedia.buildReport", (input = {}) => social.buildReport(input));
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/social-media/") || pathname.startsWith("/api/plugin-ui/social-media-manager/")) {
            next.add("social-media");
          }
          return [...next];
        });
      }

      if (typeof api.registerTool === "function") {
        for (const tool of tools) {
          api.registerTool(tool);
        }
      }

      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "social-media-manager",
          title: "Social",
          icon: "S",
          order: 37,
          scriptUrl: "/api/plugin-ui/social-media-manager/tab.js"
        });
      }

      if (typeof api.addHook === "function") {
        api.addHook("intake:tools:list", async (payload = {}) => {
          const existing = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
          return {
            ...payload,
            tools: [
              ...existing,
              ...tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters || {}
              }))
            ]
          };
        });

        api.addHook("intake:tool-call", async (payload = {}) => {
          const name = String(payload?.name || "").trim();
          const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

          if (name === "social_save_product") {
            const product = await social.saveProduct(args);
            return handled(payload, { text: `Saved product ${product.id}: ${product.name}.`, product });
          }

          if (name === "social_find_posting_opportunities") {
            const result = await social.discoverOpportunities(args);
            const lines = result.opportunities.map((entry) =>
              `- ${entry.platformName}: ${entry.title} (${entry.score}/100, ${entry.risk} risk) ${entry.url}`
            );
            return handled(payload, {
              text: lines.length ? lines.join("\n") : "No social posting opportunities generated.",
              ...result
            });
          }

          if (name === "social_compose_posts") {
            const posts = await social.composePosts(args);
            return handled(payload, {
              text: posts.map((post) => `- ${post.id} [${post.platform || "social"}]: ${compactText(post.body, 180)}`).join("\n"),
              posts
            });
          }

          if (name === "social_save_publishing_target") {
            const target = await social.savePublishingTarget(args);
            return handled(payload, { text: `Saved publishing target ${target.id}: ${target.label}.`, publishingTarget: target });
          }

          if (name === "social_update_post") {
            const postId = String(args.postId || args.id || "").trim();
            if (!postId) {
              throw new Error("postId is required");
            }
            const post = await social.updatePost(postId, args);
            return handled(payload, { text: `Updated post ${post.id} (${post.status}).`, post });
          }

          if (name === "social_record_interaction") {
            const interaction = await social.recordInteraction(args);
            return handled(payload, {
              text: `Recorded interaction ${interaction.id}. Suggested reply: ${interaction.replyDraft}`,
              interaction
            });
          }

          if (name === "social_update_interaction") {
            const interactionId = String(args.interactionId || args.id || "").trim();
            if (!interactionId) {
              throw new Error("interactionId is required");
            }
            const interaction = await social.updateInteraction(interactionId, args);
            return handled(payload, { text: `Updated interaction ${interaction.id} (${interaction.replyStatus}).`, interaction });
          }

          if (name === "social_get_report") {
            const report = await social.buildReport(args);
            return handled(payload, report);
          }

          if (name === "social_list_browser_accounts") {
            const listAccounts = api.getCapability("browser.accounts.list");
            if (typeof listAccounts !== "function") {
              return handled(payload, { text: "Browser account capability is unavailable.", accounts: [] });
            }
            const service = String(args.service || args.platform || "").trim().toLowerCase();
            const accounts = (await listAccounts()).filter((account) => !service || String(account.service || "").toLowerCase() === service);
            return handled(payload, {
              text: accounts.length
                ? accounts.map((account) => `- ${account.id}: ${account.label} (${account.status}, password: ${account.hasPassword ? "stored" : "missing"})`).join("\n")
                : "No matching browser accounts are configured.",
              accounts
            });
          }

          if (name === "social_publish_post_browser") {
            const postId = String(args.postId || args.id || "").trim();
            if (!postId) throw new Error("postId is required");
            const state = await social.listState();
            const post = (state.posts || []).find((entry) => String(entry.id || "") === postId);
            if (!post) throw new Error("post not found");
            const browserAction = api.getCapability("browser.externalAction");
            if (typeof browserAction !== "function") {
              return handled(payload, { text: "Browser external action capability is unavailable.", post });
            }
            const url = String(args.url || post.publishedUrl || "").trim();
            const bodySelector = String(args.bodySelector || "").trim();
            const titleSelector = String(args.titleSelector || "").trim();
            const submitSelector = String(args.submitSelector || "").trim();
            if (!url || !bodySelector || !submitSelector) {
              throw new Error("url, bodySelector, and submitSelector are required");
            }
            const base = {
              service: String(args.service || post.platform || "").trim(),
              accountId: String(args.accountId || "").trim(),
              requiresApproval: args.requiresApproval !== false,
              taskContext: args.taskContext,
              toolCallId: args.toolCallId
            };
            const steps = [];
            steps.push(await browserAction({
              ...base,
              action: "navigate",
              url,
              summary: `Navigate to social composer for post ${post.id}`,
              riskLevel: "normal",
              requiresApproval: false
            }));
            if (titleSelector && post.title) {
              steps.push(await browserAction({
                ...base,
                action: "fill",
                selector: titleSelector,
                value: post.title,
                summary: `Fill social post title for ${post.id}`
              }));
            }
            steps.push(await browserAction({
              ...base,
              action: "fill",
              selector: bodySelector,
              value: post.body,
              summary: `Fill social post body for ${post.id}`
            }));
            steps.push(await browserAction({
              ...base,
              action: "click",
              selector: submitSelector,
              summary: `Submit social post ${post.id}`
            }));
            const updated = await social.updatePost(post.id, {
              status: "published",
              publishedUrl: url,
              publishedAt: Date.now()
            });
            return handled(payload, {
              text: `Published post ${updated.id} through browser account ${base.service}:${base.accountId || "default"}.`,
              post: updated,
              steps
            });
          }

          if (name === "social_publish_post") {
            const postId = String(args.postId || args.id || "").trim();
            if (!postId) throw new Error("postId is required");
            const state = await social.listState();
            const post = (state.posts || []).find((entry) => String(entry.id || "") === postId);
            if (!post) throw new Error("post not found");
            const target = await social.findPublishingTarget({
              targetId: args.targetId,
              platform: args.platform || post.platform,
              accountId: args.accountId
            });
            if (!target) throw new Error("publishing target not found");
            const browserAction = requireCapability(api, "browser.externalAction");
            const service = target.platform || post.platform;
            const accountId = String(args.accountId || target.accountId || "default").trim();
            if (!target.composerUrl || !target.bodySelector || !target.submitSelector) {
              throw new Error("publishing target requires composerUrl, bodySelector, and submitSelector");
            }
            const base = {
              service,
              accountId,
              requiresApproval: args.requiresApproval !== false,
              taskContext: args.taskContext,
              toolCallId: args.toolCallId
            };
            const steps = [];
            steps.push(await browserAction({
              ...base,
              action: "navigate",
              url: target.composerUrl,
              summary: `Open ${target.label} composer for post ${post.id}`,
              riskLevel: "normal",
              requiresApproval: false
            }));
            if (target.titleSelector && post.title) {
              steps.push(await browserAction({
                ...base,
                action: "fill",
                selector: target.titleSelector,
                value: post.title,
                summary: `Fill title for social post ${post.id}`
              }));
            }
            steps.push(await browserAction({
              ...base,
              action: "fill",
              selector: target.bodySelector,
              value: post.body,
              summary: `Fill body for social post ${post.id}`
            }));
            steps.push(await browserAction({
              ...base,
              action: "click",
              selector: target.submitSelector,
              summary: `Submit social post ${post.id} to ${target.label}`
            }));
            await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(Number(args.waitMs || 2500), 10000))));
            let publishedUrl = await getCurrentBrowserUrl(api, { service, accountId });
            if (target.publishedUrlSelector) {
              const daemonFactory = api.getCapability("browser.daemon");
              const daemon = typeof daemonFactory === "function" ? daemonFactory() : null;
              const href = daemon
                ? await daemon.evaluateJs(`
                  const el = document.querySelector(${JSON.stringify(target.publishedUrlSelector)});
                  return el?.href || el?.getAttribute("href") || "";
                `, { sessionId: normalizeSessionId(service, accountId) }).then((r) => r?.result || "").catch(() => "")
                : "";
              if (href) publishedUrl = href;
            }
            const updated = await social.updatePost(post.id, {
              status: "published",
              publishedUrl: publishedUrl || target.composerUrl,
              publishedAt: Date.now()
            });
            return handled(payload, {
              text: `Published post ${updated.id} to ${target.label}. ${updated.publishedUrl}`,
              post: updated,
              publishingTarget: target,
              steps
            });
          }

          if (name === "social_monitor_post_browser") {
            const postId = String(args.postId || args.id || "").trim();
            const state = await social.listState();
            const post = postId ? (state.posts || []).find((entry) => String(entry.id || "") === postId) : null;
            const url = String(args.url || post?.publishedUrl || "").trim();
            if (!url) throw new Error("url or postId with publishedUrl is required");
            const browserAction = api.getCapability("browser.externalAction");
            const browserDaemon = api.getCapability("browser.daemon");
            if (typeof browserAction !== "function" || typeof browserDaemon !== "function") {
              return handled(payload, { text: "Browser capabilities are unavailable.", post });
            }
            const service = String(args.service || post?.platform || "").trim();
            const accountId = String(args.accountId || "").trim();
            await browserAction({
              action: "navigate",
              url,
              service,
              accountId,
              riskLevel: "normal",
              requiresApproval: false,
              summary: `Monitor social post page ${post?.id || url}`
            });
            const daemon = browserDaemon();
            const sessionId = service || accountId ? `${service || "web"}:${accountId || "default"}` : "default";
            const selector = String(args.textSelector || "body").trim();
            const text = await daemon.getText(selector, { sessionId }).catch(() => "");
            const metrics = await daemon.getPageMetrics({ sessionId }).catch(() => ({}));
            return handled(payload, {
              text: compactText(text, 4000),
              pageText: text,
              metrics,
              post
            });
          }

          if (name === "social_monitor_posts") {
            const state = await social.listState();
            const requestedPostId = String(args.postId || args.id || "").trim();
            const limit = Math.max(1, Math.min(Number(args.limit || 10) || 10, 50));
            const posts = (state.posts || [])
              .filter((post) => post.status === "published" && post.publishedUrl)
              .filter((post) => !requestedPostId || post.id === requestedPostId)
              .slice(0, limit);
            const browserAction = requireCapability(api, "browser.externalAction");
            const monitored = [];
            for (const post of posts) {
              const target = await social.findPublishingTarget({
                targetId: args.targetId,
                platform: args.platform || post.platform,
                accountId: args.accountId
              });
              const service = String(target?.platform || args.platform || post.platform || "web").trim();
              const accountId = String(args.accountId || target?.accountId || "default").trim();
              await browserAction({
                action: "navigate",
                url: post.publishedUrl,
                service,
                accountId,
                riskLevel: "normal",
                requiresApproval: false,
                summary: `Monitor published social post ${post.id}`
              });
              const daemonFactory = api.getCapability("browser.daemon");
              const daemon = typeof daemonFactory === "function" ? daemonFactory() : null;
              const selector = String(target?.monitorTextSelector || "body").trim();
              const pageText = daemon
                ? await daemon.getText(selector, { sessionId: normalizeSessionId(service, accountId) }).catch(() => "")
                : "";
              const metrics = daemon
                ? await daemon.getPageMetrics({ sessionId: normalizeSessionId(service, accountId) }).catch(() => ({}))
                : {};
              const comments = await extractComments(api, { service, accountId, target: target || {}, post, fallbackText: pageText });
              const snapshot = await social.recordMonitorSnapshot({
                postId: post.id,
                metrics: {
                  comments: comments.length,
                  views: Number(metrics.views || post.metrics?.views || 0) || 0
                },
                comments
              });
              monitored.push({
                postId: post.id,
                url: post.publishedUrl,
                commentCandidates: comments.length,
                recordedCount: snapshot.recordedCount,
                metrics
              });
            }
            return handled(payload, {
              text: monitored.length
                ? monitored.map((entry) => `- ${entry.postId}: ${entry.recordedCount} new interactions from ${entry.commentCandidates} candidates`).join("\n")
                : "No published posts matched the monitor request.",
              monitored
            });
          }

          return payload;
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/social-media-manager/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "social-media-manager-tab.js"));
      });

      app.get("/api/social-media/state", async (_req, res) => {
        try {
          const listState = api.getCapability("socialMedia.listState");
          if (typeof listState !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, ...(await listState()) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load social media state") });
        }
      });

      app.post("/api/social-media/products", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const saveProduct = api.getCapability("socialMedia.saveProduct");
          if (typeof saveProduct !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          const product = await saveProduct(req.body || {});
          res.json({ ok: true, product });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save product") });
        }
      });

      app.post("/api/social-media/opportunities/discover", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const discover = api.getCapability("socialMedia.discoverOpportunities");
          if (typeof discover !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, ...(await discover(req.body || {})) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to discover opportunities") });
        }
      });

      app.post("/api/social-media/posts/compose", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const compose = api.getCapability("socialMedia.composePosts");
          if (typeof compose !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, posts: await compose(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to compose posts") });
        }
      });

      app.post("/api/social-media/publishing-targets", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const saveTarget = api.getCapability("socialMedia.savePublishingTarget");
          if (typeof saveTarget !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, publishingTarget: await saveTarget(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save publishing target") });
        }
      });

      app.post("/api/social-media/posts/:postId/publish", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const hook = async (payload) => await api.runHook?.("intake:tool-call", payload);
          const result = await hook({
            name: "social_publish_post",
            args: { ...(req.body || {}), postId: req.params.postId }
          });
          if (result?.handled !== true) {
            return res.status(503).json({ ok: false, error: "social publish tool unavailable" });
          }
          res.json({ ok: true, ...(result.result || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to publish post") });
        }
      });

      app.post("/api/social-media/posts/monitor", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const result = await api.runHook?.("intake:tool-call", {
            name: "social_monitor_posts",
            args: req.body || {}
          });
          if (result?.handled !== true) {
            return res.status(503).json({ ok: false, error: "social monitor tool unavailable" });
          }
          res.json({ ok: true, ...(result.result || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to monitor posts") });
        }
      });

      app.patch("/api/social-media/posts/:postId", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const updatePost = api.getCapability("socialMedia.updatePost");
          if (typeof updatePost !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, post: await updatePost(req.params.postId, req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update post") });
        }
      });

      app.post("/api/social-media/interactions", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const record = api.getCapability("socialMedia.recordInteraction");
          if (typeof record !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, interaction: await record(req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to record interaction") });
        }
      });

      app.patch("/api/social-media/interactions/:interactionId", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const updateInteraction = api.getCapability("socialMedia.updateInteraction");
          if (typeof updateInteraction !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, interaction: await updateInteraction(req.params.interactionId, req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update interaction") });
        }
      });

      app.get("/api/social-media/report", async (req, res) => {
        try {
          const buildReport = api.getCapability("socialMedia.buildReport");
          if (typeof buildReport !== "function") {
            return res.status(503).json({ ok: false, error: "social media manager capability is unavailable" });
          }
          res.json({ ok: true, ...(await buildReport(req.query || {})) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to build report") });
        }
      });
    }
  };
}

export default createSocialMediaManagerPlugin;
