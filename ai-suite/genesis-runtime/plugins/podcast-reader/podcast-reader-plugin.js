/**
 * Plugin Name: Podcast Reader
 * Plugin Slug: podcast-reader
 * Description: Lets Nova read a website aloud as a lightweight podcast-style narration.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_KEY = "podcast-reader-state";
const MAX_SCRIPT_CHARS = 20000;
const DEFAULT_SCRIPT_CHARS = 12000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("url is required");
  }
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  return parsed.href;
}

function decodeHtmlEntities(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity || "").toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
  });
}

function extractTitle(html = "", url = "") {
  const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeHtmlEntities(String(titleMatch?.[1] || "").replace(/\s+/g, " ").trim());
  if (title) {
    return compactText(title, 160);
  }
  try {
    return new URL(url).hostname;
  } catch {
    return "this website";
  }
}

function cleanHtmlToText(html = "") {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(nav|footer|form|aside|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|section|article|main|h[1-6]|li|blockquote|tr)>/gi, ". ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/([.!?])\s*\1+/g, "$1")
      .trim()
  );
}

function splitSentences(text = "") {
  const matches = String(text || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (matches || [])
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter((entry) => entry.length > 20);
}

function buildPodcastScript({ title = "", url = "", text = "", maxChars = DEFAULT_SCRIPT_CHARS } = {}) {
  const limit = Math.max(1500, Math.min(Number(maxChars || DEFAULT_SCRIPT_CHARS) || DEFAULT_SCRIPT_CHARS, MAX_SCRIPT_CHARS));
  const sentences = splitSentences(text);
  const body = [];
  let length = 0;
  for (const sentence of sentences) {
    if (length + sentence.length + 1 > limit) {
      break;
    }
    body.push(sentence);
    length += sentence.length + 1;
  }
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  })();
  const intro = `[nova:emotion=explain] Welcome back. Today I am reading ${title || "this page"}${host ? ` from ${host}` : ""}.`;
  const outro = "That is the end of the page. I can keep going from another link whenever you want.";
  return [intro, ...body, outro].filter(Boolean).join("\n\n");
}

async function fetchWebsiteText(url = "", { timeoutMs = 18000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(2000, Math.min(Number(timeoutMs || 18000), 45000)));
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "Nova Observer Podcast Reader/1.0"
      }
    });
    const contentType = String(response.headers.get("content-type") || "").trim();
    const raw = await response.text();
    const title = contentType.includes("html") ? extractTitle(raw, response.url || url) : extractTitle("", response.url || url);
    const text = contentType.includes("html") ? cleanHtmlToText(raw) : raw.replace(/\s+/g, " ").trim();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      contentType,
      title,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeState(input = {}) {
  const state = input && typeof input === "object" ? input : {};
  return {
    lastEpisode: state.lastEpisode && typeof state.lastEpisode === "object" ? state.lastEpisode : null,
    history: Array.isArray(state.history) ? state.history.slice(-20) : []
  };
}

function createEpisode(payload = {}) {
  return {
    id: `podcast-${Date.now().toString(36)}`,
    createdAt: nowIso(),
    url: String(payload.url || "").trim(),
    finalUrl: String(payload.finalUrl || payload.url || "").trim(),
    title: compactText(payload.title || "Website reading", 180),
    script: String(payload.script || "").trim(),
    sourceTextChars: Number(payload.sourceTextChars || 0) || 0,
    scriptChars: String(payload.script || "").length,
    status: String(payload.status || "ready").trim() || "ready"
  };
}

export function createPodcastReaderPlugin(options = {}) {
  const {
    pluginId = "podcast-reader",
    pluginName = "Podcast Reader",
    description = "Lets Nova read websites aloud in a podcast-style flow."
  } = options;

  async function readWebsiteAsPodcast(api, args = {}) {
    const url = normalizeUrl(args.url || args.website || args.link);
    const maxChars = Math.max(1500, Math.min(Number(args.maxChars || DEFAULT_SCRIPT_CHARS) || DEFAULT_SCRIPT_CHARS, MAX_SCRIPT_CHARS));
    const fetched = await fetchWebsiteText(url, { timeoutMs: args.timeoutMs });
    if (!fetched.text) {
      throw new Error("no readable text found at url");
    }
    const script = buildPodcastScript({
      title: args.title || fetched.title,
      url: fetched.finalUrl || url,
      text: fetched.text,
      maxChars
    });
    const episode = createEpisode({
      url,
      finalUrl: fetched.finalUrl,
      title: args.title || fetched.title,
      script,
      sourceTextChars: fetched.text.length,
      status: fetched.ok ? "ready" : `http-${fetched.status || "unknown"}`
    });
    const current = normalizeState(await api.data.readJson(STATE_KEY, {}));
    const nextState = {
      lastEpisode: episode,
      history: [...current.history, episode].slice(-20)
    };
    await api.data.writeJson(STATE_KEY, nextState);
    api.broadcast?.({
      type: "podcast-reader.episode-ready",
      episode
    });
    return {
      ok: true,
      episode,
      text: `Prepared ${episode.title} for Nova to read aloud.`
    };
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
        capabilities: [
          "subsystem:classify",
          "podcast-reader.readWebsite"
        ],
        tools: ["read_website_as_podcast"],
        hooks: ["intake:tool-call"],
        runtimeContext: []
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
      api.provideCapability?.("podcast-reader.readWebsite", (args = {}) => readWebsiteAsPodcast(api, args));
      api.provideCapability?.("subsystem:classify", (payload = {}) => {
        const pathname = String(payload?.path || "").trim().toLowerCase();
        const existing = Array.isArray(payload?.subsystems)
          ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
          : [];
        const next = new Set(existing);
        if (pathname.startsWith("/api/podcast-reader/") || pathname.startsWith("/api/plugin-ui/podcast-reader/")) {
          next.add("podcast-reader");
          next.add("voice");
        }
        return [...next];
      });
      api.registerTool?.({
        name: "read_website_as_podcast",
        description: "Fetch a website, convert the readable content into a podcast-style Nova narration script, and start it in the Podcast Reader tab.",
        scopes: ["worker"],
        risk: "normal",
        parameters: {
          url: "string (required)",
          title: "string",
          maxChars: "number",
          timeoutMs: "number"
        }
      });
      api.addHook?.("intake:tool-call", async (payload = {}) => {
        if (String(payload?.name || "").trim() !== "read_website_as_podcast") {
          return payload;
        }
        try {
          const result = await readWebsiteAsPodcast(api, payload.args || {});
          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: {
              ok: false,
              error: true,
              message: String(error?.message || error || "failed to prepare podcast reading")
            }
          };
        }
      });
      api.registerUiIdentityTab?.({
        id: "podcast-reader",
        title: "Podcast Reader",
        order: 47,
        scriptUrl: "/api/plugin-ui/podcast-reader/nova-tab.js"
      });
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/podcast-reader/nova-tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "podcast-reader-nova-tab.js"));
      });

      app.get("/api/podcast-reader/state", async (_req, res) => {
        try {
          const state = normalizeState(await api.data.readJson(STATE_KEY, {}));
          res.json({ ok: true, ...state });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load podcast reader state") });
        }
      });

      app.post("/api/podcast-reader/read", async (req, res) => {
        try {
          const result = await readWebsiteAsPodcast(api, req.body || {});
          res.json(result);
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to prepare podcast reading") });
        }
      });
    }
  };
}

export default createPodcastReaderPlugin;
