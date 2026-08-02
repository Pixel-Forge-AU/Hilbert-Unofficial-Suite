import crypto from "node:crypto";
import { compactText } from "../../../observer-general-utils.js";

const WORDPRESS_BRIDGE_NAMESPACE = "nova-bridge/v1";

function normalizeWordPressBaseUrl(value = "") {
  let raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  try {
    const parsed = new URL(raw);
    let pathname = parsed.pathname.replace(/\/+$/g, "");
    pathname = pathname.replace(/\/wp-json(?:\/.*)?$/i, "");
    return `${parsed.origin}${pathname}`.replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function normalizeWordPressSiteId(value = "", fallbackBaseUrl = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw) {
    return raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  }
  const normalizedBaseUrl = normalizeWordPressBaseUrl(fallbackBaseUrl);
  if (!normalizedBaseUrl) {
    return "";
  }
  try {
    const parsed = new URL(normalizedBaseUrl);
    const hostPart = parsed.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const pathPart = parsed.pathname.replace(/\/+/g, "-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "");
    return [hostPart, pathPart].filter(Boolean).join("-");
  } catch {
    return "";
  }
}

function normalizeWordPressPostStatus(value = "", fallback = "draft") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["draft", "publish", "private", "pending", "future"].includes(normalized)) {
    return normalized;
  }
  return String(fallback || "draft").trim().toLowerCase() || "draft";
}

function normalizeWordPressTermList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === "number" ? entry : String(entry || "").trim())
      .filter((entry) => entry !== "" && entry != null);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeWordPressImageSpec(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const url = String(value || "").trim();
    return url ? { url } : null;
  }
  if (typeof value === "number") {
    return value > 0 ? { id: Number(value) } : null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const imageId = Number(value.id || value.imageId || value.attachmentId || 0);
  const url = String(value.url || value.src || "").trim();
  const alt = compactText(String(value.alt || value.imageAlt || "").trim(), 220);
  const caption = compactText(String(value.caption || "").trim(), 400);
  const title = compactText(String(value.title || "").trim(), 220);
  if (!(imageId > 0) && !url) {
    return null;
  }
  return {
    id: imageId > 0 ? imageId : undefined,
    url: url || undefined,
    alt: alt || undefined,
    caption: caption || undefined,
    title: title || undefined
  };
}

function normalizeWordPressImageList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeWordPressImageSpec(entry)).filter(Boolean);
}

function normalizeWordPressSectionList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const heading = compactText(String(entry.heading || entry.title || "").trim(), 220);
      const body = String(entry.body || entry.content || "").trim();
      const html = String(entry.html || "").trim();
      const image = normalizeWordPressImageSpec(entry.image || entry.imageUrl || entry.media || null);
      const gallery = normalizeWordPressImageList(entry.gallery || entry.images || []);
      if (!heading && !body && !html && !image && !gallery.length) {
        return null;
      }
      return {
        heading: heading || undefined,
        body: body || undefined,
        html: html || undefined,
        image: image || undefined,
        gallery
      };
    })
    .filter(Boolean);
}

function normalizeWordPressLayout(value = {}, fallbackArgs = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const intro = String(input.intro || fallbackArgs.intro || "").trim();
  const conclusion = String(input.conclusion || fallbackArgs.conclusion || "").trim();
  const callToAction = String(input.callToAction || input.cta || fallbackArgs.callToAction || "").trim();
  const sections = normalizeWordPressSectionList(
    Array.isArray(input.sections) ? input.sections : fallbackArgs.sections
  );
  const inlineImages = normalizeWordPressImageList(
    Array.isArray(input.inlineImages) ? input.inlineImages : fallbackArgs.inlineImages
  );
  if (!intro && !conclusion && !callToAction && !sections.length && !inlineImages.length) {
    return null;
  }
  return {
    intro: intro || undefined,
    sections,
    inlineImages,
    conclusion: conclusion || undefined,
    callToAction: callToAction || undefined
  };
}

export function createWordPressDomain(context = {}) {
  const {
    fs,
    path,
    registryPath = "",
    normalizeSecretHandle = (value = "") => String(value || "").trim(),
    buildWordPressSharedSecretHandle = (siteId = "") => `wordpress/site/${siteId}/shared-secret`,
    getSecretValue = async () => "",
    hasSecretValue = async () => false,
    setSecretValue = async () => ({}),
    deleteSecretValue = async () => ({})
  } = context;

  let wordpressSiteRegistryState = null;

  function normalizeWordPressSiteEntry(entry = {}) {
    const baseUrl = normalizeWordPressBaseUrl(entry.baseUrl || entry.url || "");
    const siteId = normalizeWordPressSiteId(entry.siteId || entry.id || "", baseUrl);
    const label = compactText(String(entry.label || entry.name || siteId || baseUrl).trim(), 120);
    const aliases = (Array.isArray(entry.aliases) ? entry.aliases : String(entry.aliases || "").split(","))
      .map((alias) => String(alias || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    return {
      siteId,
      label,
      aliases,
      baseUrl,
      keyId: compactText(String(entry.keyId || entry.apiKeyId || "").trim(), 120),
      sharedSecretHandle: normalizeSecretHandle(
        entry.sharedSecretHandle
        || entry.secretHandle
        || (siteId ? buildWordPressSharedSecretHandle(siteId) : "")
      ),
      sharedSecret: String(entry.sharedSecret || entry.secret || "").trim(),
      defaultStatus: normalizeWordPressPostStatus(entry.defaultStatus || "draft"),
      updatedAt: Number(entry.updatedAt || Date.now())
    };
  }

  async function buildWordPressSitePublicView(site = {}) {
    const sharedSecretHandle = normalizeSecretHandle(site.sharedSecretHandle || "");
    const hasSecret = sharedSecretHandle
      ? await hasSecretValue(sharedSecretHandle)
      : Boolean(String(site.sharedSecret || "").trim());
    const activeSiteId = wordpressSiteRegistryState?.activeSiteId || "";
    return {
      siteId: String(site.siteId || "").trim(),
      label: String(site.label || "").trim(),
      aliases: Array.isArray(site.aliases) ? site.aliases : [],
      baseUrl: String(site.baseUrl || "").trim(),
      keyId: String(site.keyId || "").trim(),
      sharedSecretHandle,
      defaultStatus: normalizeWordPressPostStatus(site.defaultStatus || "draft"),
      hasSecret,
      maskedSecret: hasSecret ? "stored in system keychain" : "",
      isActive: Boolean(activeSiteId) && String(site.siteId || "").trim() === activeSiteId,
      updatedAt: Number(site.updatedAt || 0)
    };
  }

  async function ensureWordPressSiteSecretStored(site = {}) {
    const sharedSecretHandle = normalizeSecretHandle(
      site.sharedSecretHandle
      || (site.siteId ? buildWordPressSharedSecretHandle(site.siteId) : "")
    );
    const legacySharedSecret = String(site.sharedSecret || "").trim();
    if (!sharedSecretHandle || !legacySharedSecret) {
      return {
        ...site,
        sharedSecretHandle
      };
    }
    await setSecretValue(sharedSecretHandle, legacySharedSecret);
    return {
      ...site,
      sharedSecretHandle,
      sharedSecret: ""
    };
  }

  async function resolveWordPressSharedSecret(site = {}) {
    const sharedSecretHandle = normalizeSecretHandle(site.sharedSecretHandle || "");
    if (sharedSecretHandle) {
      const resolved = await getSecretValue(sharedSecretHandle);
      if (String(resolved || "").trim()) {
        return String(resolved || "");
      }
    }
    return String(site.sharedSecret || "");
  }

  async function loadWordPressSiteRegistry() {
    if (wordpressSiteRegistryState) {
      return wordpressSiteRegistryState;
    }
    try {
      const raw = await fs.readFile(registryPath, "utf8");
      const parsed = JSON.parse(raw);
      wordpressSiteRegistryState = {
        sites: Array.isArray(parsed?.sites)
          ? parsed.sites.map((entry) => normalizeWordPressSiteEntry(entry)).filter((entry) => entry.siteId && entry.baseUrl)
          : [],
        activeSiteId: normalizeWordPressSiteId(parsed?.activeSiteId || "")
      };
    } catch {
      wordpressSiteRegistryState = { sites: [], activeSiteId: "" };
    }
    let migrated = false;
    wordpressSiteRegistryState.sites = await Promise.all(
      wordpressSiteRegistryState.sites.map(async (entry) => {
        const upgraded = await ensureWordPressSiteSecretStored(entry);
        if (String(entry.sharedSecret || "").trim() && !String(upgraded.sharedSecret || "").trim()) {
          migrated = true;
        }
        return upgraded;
      })
    );
    if (migrated) {
      await saveWordPressSiteRegistry();
    }
    return wordpressSiteRegistryState;
  }

  async function saveWordPressSiteRegistry() {
    const state = await loadWordPressSiteRegistry();
    const serializedState = {
      sites: (Array.isArray(state.sites) ? state.sites : []).map((entry) => ({
        siteId: String(entry.siteId || "").trim(),
        label: String(entry.label || "").trim(),
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
        baseUrl: String(entry.baseUrl || "").trim(),
        keyId: String(entry.keyId || "").trim(),
        sharedSecretHandle: normalizeSecretHandle(entry.sharedSecretHandle || ""),
        defaultStatus: normalizeWordPressPostStatus(entry.defaultStatus || "draft"),
        updatedAt: Number(entry.updatedAt || Date.now())
      })),
      activeSiteId: normalizeWordPressSiteId(state.activeSiteId || "")
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, `${JSON.stringify(serializedState, null, 2)}\n`, "utf8");
  }

  async function listWordPressSites() {
    const state = await loadWordPressSiteRegistry();
    return Promise.all(state.sites.map((entry) => buildWordPressSitePublicView(entry)));
  }

  async function saveWordPressSite(args = {}) {
    const normalized = normalizeWordPressSiteEntry(args);
    if (!normalized.siteId) {
      throw new Error("siteId or baseUrl is required");
    }
    if (!normalized.baseUrl) {
      throw new Error("baseUrl is required");
    }
    if (!normalized.keyId) {
      throw new Error("keyId is required");
    }
    const state = await loadWordPressSiteRegistry();
    const index = state.sites.findIndex((entry) => String(entry.siteId || "").trim() === normalized.siteId);
    const existing = index >= 0 ? state.sites[index] : null;
    const sharedSecretHandle = normalizeSecretHandle(
      normalized.sharedSecretHandle
      || existing?.sharedSecretHandle
      || buildWordPressSharedSecretHandle(normalized.siteId)
    );
    const providedSharedSecret = String(args.sharedSecret || args.secret || "").trim();
    const hasExistingSecret = sharedSecretHandle ? await hasSecretValue(sharedSecretHandle) : false;
    if (!providedSharedSecret && !hasExistingSecret) {
      throw new Error("sharedSecret is required");
    }
    if (providedSharedSecret) {
      await setSecretValue(sharedSecretHandle, providedSharedSecret);
    }
    const nextEntry = {
      ...(existing || {}),
      ...normalized,
      sharedSecretHandle,
      sharedSecret: "",
      updatedAt: Date.now()
    };
    if (index >= 0) {
      state.sites[index] = nextEntry;
    } else {
      state.sites.unshift(nextEntry);
    }
    state.sites = state.sites
      .filter((entry) => entry.siteId && entry.baseUrl)
      .sort((left, right) => String(left.label || left.siteId).localeCompare(String(right.label || right.siteId)));
    await saveWordPressSiteRegistry();
    return buildWordPressSitePublicView(state.sites.find((entry) => entry.siteId === normalized.siteId) || nextEntry);
  }

  async function removeWordPressSite(args = {}) {
    const siteId = normalizeWordPressSiteId(args.siteId || args.id || "");
    if (!siteId) {
      throw new Error("siteId is required");
    }
    const state = await loadWordPressSiteRegistry();
    const index = state.sites.findIndex((entry) => String(entry.siteId || "").trim() === siteId);
    if (index < 0) {
      throw new Error(`WordPress site "${siteId}" was not found`);
    }
    const [removed] = state.sites.splice(index, 1);
    const sharedSecretHandle = normalizeSecretHandle(removed?.sharedSecretHandle || "");
    if (sharedSecretHandle) {
      await deleteSecretValue(sharedSecretHandle);
    }
    await saveWordPressSiteRegistry();
    return buildWordPressSitePublicView(removed);
  }

  function looseKey(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function findWordPressSiteEntry(state, requestedId = "") {
    const normalizedSiteId = normalizeWordPressSiteId(requestedId);
    if (!normalizedSiteId) {
      return null;
    }
    return state.sites.find((entry) => String(entry.siteId || "").trim() === normalizedSiteId)
      || state.sites.find((entry) => looseKey(entry.siteId) === looseKey(normalizedSiteId))
      || state.sites.find((entry) => (entry.aliases || []).some((alias) => looseKey(alias) === looseKey(normalizedSiteId)))
      || state.sites.find((entry) => {
        try {
          return looseKey(new URL(entry.baseUrl).hostname) === looseKey(normalizedSiteId)
            || looseKey(`www${new URL(entry.baseUrl).hostname}`) === looseKey(normalizedSiteId);
        } catch {
          return false;
        }
      })
      || state.sites.find((entry) => looseKey(entry.label) === looseKey(normalizedSiteId))
      || null;
  }

  async function getWordPressSiteConfig(siteId = "") {
    const normalizedSiteId = normalizeWordPressSiteId(siteId);
    const state = await loadWordPressSiteRegistry();
    if (!normalizedSiteId) {
      const active = state.activeSiteId
        ? state.sites.find((entry) => String(entry.siteId || "").trim() === state.activeSiteId)
        : null;
      if (active) {
        return getWordPressSiteConfig(active.siteId);
      }
      if (state.sites.length === 1) {
        return getWordPressSiteConfig(state.sites[0].siteId);
      }
      const configured = state.sites.map((entry) => entry.siteId).filter(Boolean);
      throw new Error(configured.length
        ? `siteId is required (no active site set); configured sites: ${configured.join(", ")}. Use wordpress_set_active_site to pick one.`
        : "siteId is required and no WordPress sites are configured yet");
    }
    const site = findWordPressSiteEntry(state, normalizedSiteId);
    if (!site) {
      const configured = state.sites.map((entry) => entry.siteId).filter(Boolean);
      throw new Error(`WordPress site "${normalizedSiteId}" is not configured${configured.length ? `; configured sites: ${configured.join(", ")}` : ""}`);
    }
    const sharedSecret = await resolveWordPressSharedSecret(site);
    if (!String(site.keyId || "").trim() || !String(sharedSecret || "").trim()) {
      throw new Error(`WordPress site "${normalizedSiteId}" is missing credentials`);
    }
    return {
      ...site,
      sharedSecret
    };
  }

  function buildWordPressBridgePath(route = "") {
    const normalizedRoute = String(route || "").trim() || "/site";
    return `/wp-json/${WORDPRESS_BRIDGE_NAMESPACE}${normalizedRoute.startsWith("/") ? normalizedRoute : `/${normalizedRoute}`}`;
  }

  function buildWordPressBridgeSignature({ timestamp = "", method = "GET", requestPath = "", bodyText = "", sharedSecret = "" } = {}) {
    return crypto
      .createHmac("sha256", String(sharedSecret || ""))
      .update(`${String(timestamp || "").trim()}.${String(method || "GET").trim().toUpperCase()}.${String(requestPath || "").trim()}.${String(bodyText || "")}`, "utf8")
      .digest("hex");
  }

  async function callWordPressBridge(site, { method = "GET", route = "/site", body = null, timeoutMs = 30000 } = {}) {
    const requestPath = buildWordPressBridgePath(route);
    const normalizedMethod = String(method || "GET").trim().toUpperCase() || "GET";
    const baseUrl = String(site?.baseUrl || "").trim().replace(/\/+$/g, "");
    const url = `${baseUrl}${requestPath}`;
    const bodyText = body == null ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      "x-nova-key": String(site?.keyId || "").trim(),
      "x-nova-timestamp": timestamp,
      "x-nova-signature": buildWordPressBridgeSignature({
        timestamp,
        method: normalizedMethod,
        requestPath,
        bodyText,
        sharedSecret: String(site?.sharedSecret || "")
      }),
      accept: "application/json"
    };
    if (bodyText) {
      headers["content-type"] = "application/json";
    }
    let response;
    try {
      response = await fetch(url, {
        method: normalizedMethod,
        headers,
        body: bodyText || undefined,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs || 30000), 120000)))
      });
    } catch (error) {
      throw new Error(`WordPress request failed for ${site?.siteId || site?.baseUrl || "site"}: ${error.message}`);
    }
    const rawText = await response.text();
    let payload = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = { raw: rawText };
    }
    if (!response.ok || payload?.ok === false) {
      throw new Error(String(payload?.error || payload?.message || `WordPress bridge returned HTTP ${response.status}`));
    }
    return payload;
  }

  async function testConnection(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "GET",
      route: "/site",
      timeoutMs: Number(args.timeoutMs || 20000)
    });
    return {
      text: `Connected to ${site.label || site.siteId}. Remote site: ${result?.site?.name || result?.site?.url || site.baseUrl}.`,
      site: await buildWordPressSitePublicView(site),
      remoteSite: result.site || {}
    };
  }

  async function getDiagnostics(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "GET",
      route: "/diagnostics",
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    const diagnostics = result.diagnostics || {};
    const pluginSummary = diagnostics.plugins && typeof diagnostics.plugins === "object"
      ? diagnostics.plugins
      : {};
    return {
      text: `Fetched WordPress diagnostics for ${site.label || site.siteId}. Active plugins: ${Number(pluginSummary.activeCount || 0)}. Updates available: ${Number(pluginSummary.updateCount || 0)}.`,
      site: await buildWordPressSitePublicView(site),
      diagnostics
    };
  }

  async function getHealth(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "GET",
      route: "/health",
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    const health = result.health || {};
    const checks = Array.isArray(health.checks) ? health.checks : [];
    const failures = checks.filter((entry) => entry && entry.ok === false);
    return {
      text: failures.length
        ? `WordPress health checks completed for ${site.label || site.siteId}. ${failures.length} check${failures.length === 1 ? "" : "s"} failed.`
        : `All WordPress health checks passed for ${site.label || site.siteId}.`,
      site: await buildWordPressSitePublicView(site),
      health
    };
  }

  async function getMonitorStatus(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "GET",
      route: "/monitor",
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    const monitor = result.monitor || {};
    const state = monitor.state && typeof monitor.state === "object" ? monitor.state : {};
    return {
      text: `Fetched monitor status for ${site.label || site.siteId}. Last run: ${state.lastRunAt || "never"}.`,
      site: await buildWordPressSitePublicView(site),
      monitor
    };
  }

  async function listPlugins(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "GET",
      route: "/plugins",
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    const plugins = Array.isArray(result.plugins) ? result.plugins : [];
    return {
      text: plugins.length
        ? `Found ${plugins.length} WordPress plugin${plugins.length === 1 ? "" : "s"} on ${site.label || site.siteId}.`
        : `No plugins were returned for ${site.label || site.siteId}.`,
      site: await buildWordPressSitePublicView(site),
      plugins
    };
  }

  async function updatePlugins(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const plugins = normalizeWordPressTermList(args.plugins);
    const result = await callWordPressBridge(site, {
      method: "POST",
      route: "/plugins/update",
      body: {
        plugins,
        all: args.all === true
      },
      timeoutMs: Number(args.timeoutMs || 120000)
    });
    const updated = Array.isArray(result.updated) ? result.updated : [];
    const failed = Array.isArray(result.failed) ? result.failed : [];
    return {
      text: `Plugin update run completed for ${site.label || site.siteId}. Updated: ${updated.length}. Failed: ${failed.length}.`,
      site: await buildWordPressSitePublicView(site),
      updated,
      failed
    };
  }

  async function managePlugin(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const plugin = compactText(String(args.plugin || args.pluginFile || "").trim(), 240);
    const action = compactText(String(args.action || "").trim().toLowerCase(), 32);
    if (!plugin) {
      throw new Error("plugin is required");
    }
    if (!["activate", "deactivate"].includes(action)) {
      throw new Error("action must be activate or deactivate");
    }
    const result = await callWordPressBridge(site, {
      method: "POST",
      route: "/plugins/manage",
      body: {
        plugin,
        action
      },
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    return {
      text: `${action === "activate" ? "Activated" : "Deactivated"} ${plugin} on ${site.label || site.siteId}.`,
      site: await buildWordPressSitePublicView(site),
      plugin: result.plugin || {}
    };
  }

  async function recoverSite(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const updatePlugins = normalizeWordPressTermList(args.updatePlugins || args.plugins);
    const deactivatePlugins = normalizeWordPressTermList(args.deactivatePlugins);
    const activatePlugins = normalizeWordPressTermList(args.activatePlugins);
    const result = await callWordPressBridge(site, {
      method: "POST",
      route: "/recover",
      body: {
        updateAllPlugins: args.updateAllPlugins === true || args.all === true,
        updatePlugins,
        deactivatePlugins,
        activatePlugins
      },
      timeoutMs: Number(args.timeoutMs || 120000)
    });
    const recovery = result.recovery || {};
    const afterHealth = recovery.afterHealth && typeof recovery.afterHealth === "object"
      ? recovery.afterHealth
      : {};
    const actions = Array.isArray(recovery.actions) ? recovery.actions : [];
    return {
      text: `${afterHealth.ok === false ? "Recovery attempt completed with failing health checks" : "Recovery workflow completed"} for ${site.label || site.siteId}. Actions run: ${actions.length}.`,
      site: await buildWordPressSitePublicView(site),
      recovery
    };
  }

  async function runMonitor(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const result = await callWordPressBridge(site, {
      method: "POST",
      route: "/monitor/run",
      body: {},
      timeoutMs: Number(args.timeoutMs || 120000)
    });
    const monitor = result.monitor || {};
    return {
      text: `Ran the WordPress monitor for ${site.label || site.siteId}.`,
      site: await buildWordPressSitePublicView(site),
      monitor
    };
  }

  async function upsertPost(args = {}) {
    const site = await getWordPressSiteConfig(args.siteId);
    const postId = Number(args.wordpressPostId || args.postId || 0);
    const slug = compactText(String(args.slug || "").trim(), 180);
    const title = compactText(String(args.title || "").trim(), 220);
    const content = String(args.content || "");
    if (!(postId > 0) && !slug && !title) {
      throw new Error("title is required for a new post, or provide wordpressPostId/postId or slug for an update");
    }
    if (!content && !(postId > 0 || slug)) {
      throw new Error("content is required for a new post");
    }
    const payload = {
      postId: postId > 0 ? postId : undefined,
      title: title || undefined,
      content: content || undefined,
      slug: slug || undefined,
      excerpt: String(args.excerpt || "").trim() || undefined,
      status: normalizeWordPressPostStatus(args.status || site.defaultStatus || "draft"),
      postType: compactText(String(args.postType || "post").trim().toLowerCase(), 80) || "post",
      categories: normalizeWordPressTermList(args.categories),
      tags: normalizeWordPressTermList(args.tags),
      featuredImage: normalizeWordPressImageSpec(
        args.featuredImage || args.featuredImageUrl || args.featuredImageId || null
      ),
      layout: normalizeWordPressLayout(args.layout, args),
      meta: args.meta && typeof args.meta === "object" && !Array.isArray(args.meta) ? args.meta : undefined
    };
    const result = await callWordPressBridge(site, {
      method: "POST",
      route: "/posts/upsert",
      body: payload,
      timeoutMs: Number(args.timeoutMs || 30000)
    });
    const post = result.post || {};
    return {
      text: `Upserted WordPress ${post.postType || payload.postType || "post"} ${post.id || payload.postId || ""} on ${site.label || site.siteId}${post.viewUrl ? `: ${post.viewUrl}` : "."}`,
      site: await buildWordPressSitePublicView(site),
      post
    };
  }

  async function setActiveWordPressSite(args = {}) {
    const requested = String(args.siteId || args.mode || args.site || "").trim();
    if (!requested) {
      throw new Error("siteId (or mode alias like dev/live) is required");
    }
    const state = await loadWordPressSiteRegistry();
    const site = findWordPressSiteEntry(state, requested);
    if (!site) {
      const configured = state.sites.map((entry) => `${entry.siteId}${entry.aliases?.length ? ` (${entry.aliases.join("/")})` : ""}`);
      throw new Error(`no configured site matches "${requested}"; configured: ${configured.join(", ")}`);
    }
    state.activeSiteId = site.siteId;
    await saveWordPressSiteRegistry();
    return {
      text: `Active WordPress site is now ${site.label || site.siteId} (${site.baseUrl}). Calls without a siteId target this site.`,
      activeSiteId: site.siteId,
      site: await buildWordPressSitePublicView(site)
    };
  }

  async function getActiveWordPressSite() {
    const state = await loadWordPressSiteRegistry();
    const active = state.activeSiteId
      ? state.sites.find((entry) => String(entry.siteId || "").trim() === state.activeSiteId)
      : (state.sites.length === 1 ? state.sites[0] : null);
    return active ? buildWordPressSitePublicView(active) : null;
  }

  async function buildSecretsCatalogData() {
    const sites = await listWordPressSites();
    return {
      sites,
      handles: sites.map((site) => String(site.sharedSecretHandle || "").trim()).filter(Boolean)
    };
  }

  return {
    normalizeWordPressPostStatus,
    listWordPressSites,
    saveWordPressSite,
    removeWordPressSite,
    setActiveWordPressSite,
    getActiveWordPressSite,
    getWordPressSiteConfig,
    testConnection,
    getDiagnostics,
    getHealth,
    getMonitorStatus,
    listPlugins,
    updatePlugins,
    managePlugin,
    recoverSite,
    runMonitor,
    upsertPost,
    buildSecretsCatalogData
  };
}
