/**
 * Browser daemon — manages a persistent Playwright Chromium process.
 * Uses a long-lived browser page to avoid the 3-5s cold-start penalty per command.
 * All communication is in-process via the Playwright API (no HTTP server needed).
 */

import fs from "node:fs/promises";
import path from "node:path";

let playwrightModule = null;

async function loadPlaywright() {
  if (playwrightModule) return playwrightModule;
  try {
    playwrightModule = await import("playwright");
    return playwrightModule;
  } catch {
    try {
      playwrightModule = await import("playwright-core");
      return playwrightModule;
    } catch {
      return null;
    }
  }
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function createBrowserDaemon() {
  let browser = null;
  let browserHeadless = true;
  const sessions = new Map();
  let activeSessionId = "default";
  let idleTimer = null;
  let lastUsedAt = 0;
  const consoleErrors = [];

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    lastUsedAt = Date.now();
    idleTimer = setTimeout(async () => {
      await shutdown();
    }, IDLE_TIMEOUT_MS);
  }

  function normalizeSessionId(value = "") {
    return String(value || "default")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default";
  }

  async function fileExists(filePath = "") {
    if (!filePath) return false;
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureBrowser({ headless = true } = {}) {
    const pw = await loadPlaywright();
    if (!pw) {
      throw new Error("Playwright is not installed. Run: npm install playwright && npx playwright install chromium");
    }
    const requestedHeadless = headless !== false;
    if (browser && browserHeadless !== requestedHeadless) {
      await shutdown();
    }
    if (!browser) {
      browser = await pw.chromium.launch({ headless: requestedHeadless });
      browserHeadless = requestedHeadless;
    }
    resetIdleTimer();
    return browser;
  }

  async function createContextForSession(sessionId = "default", options = {}) {
    const b = await ensureBrowser({ headless: options.visible === true ? false : true });
    const storageStatePath = String(options.storageStatePath || "").trim();
    const contextOptions = {
      viewport: { width: Number(options.width || 1280) || 1280, height: Number(options.height || 800) || 800 },
      userAgent: String(options.userAgent || "Mozilla/5.0 (compatible; NovaBrowser/1.0)")
    };
    if (storageStatePath && await fileExists(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
    }
    const context = await b.newContext(contextOptions);
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push({ text: msg.text(), time: Date.now(), sessionId });
        if (consoleErrors.length > 200) consoleErrors.shift();
      }
    });
    const session = {
      id: sessionId,
      context,
      page,
      storageStatePath,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };
    sessions.set(sessionId, session);
    return session;
  }

  async function closeSession(sessionId = "default") {
    const id = normalizeSessionId(sessionId);
    const session = sessions.get(id);
    if (!session) return false;
    try { if (session.page) await session.page.close(); } catch {}
    try { if (session.context) await session.context.close(); } catch {}
    sessions.delete(id);
    if (activeSessionId === id) activeSessionId = "default";
    return true;
  }

  async function ensureSession(options = {}) {
    const sessionId = normalizeSessionId(options.sessionId || activeSessionId || "default");
    let session = sessions.get(sessionId);
    if (!session) {
      session = await createContextForSession(sessionId, options);
    }
    activeSessionId = sessionId;
    session.lastUsedAt = Date.now();
    resetIdleTimer();
    return session;
  }

  async function ensurePage(options = {}) {
    const session = await ensureSession(options);
    return session.page;
  }

  async function shutdown() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    for (const sessionId of [...sessions.keys()]) {
      await closeSession(sessionId);
    }
    try { if (browser) await browser.close(); } catch {}
    browser = null;
    browserHeadless = true;
    activeSessionId = "default";
  }

  async function openSession({ sessionId = "default", storageStatePath = "", visible = false, url = "" } = {}) {
    const session = await ensureSession({ sessionId, storageStatePath, visible });
    if (url) {
      await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    return {
      sessionId: session.id,
      url: session.page.url(),
      title: await session.page.title().catch(() => ""),
      storageStatePath: session.storageStatePath,
      visible: visible === true,
      active: true
    };
  }

  async function saveSession({ sessionId = activeSessionId, storageStatePath = "" } = {}) {
    const id = normalizeSessionId(sessionId);
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`browser session is not open: ${id}`);
    }
    const targetPath = String(storageStatePath || session.storageStatePath || "").trim();
    if (!targetPath) {
      throw new Error("storageStatePath is required");
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await session.context.storageState({ path: targetPath });
    session.storageStatePath = targetPath;
    return { sessionId: id, storageStatePath: targetPath, saved: true };
  }

  function listSessions() {
    return [...sessions.values()].map((session) => ({
      sessionId: session.id,
      url: session.page?.url?.() || "",
      storageStatePath: session.storageStatePath || "",
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      active: true
    }));
  }

  async function navigate(url, { waitUntil = "domcontentloaded", timeoutMs = 30000, sessionId = "", storageStatePath = "", visible = false } = {}) {
    const p = await ensurePage({ sessionId, storageStatePath, visible });
    const response = await p.goto(url, { waitUntil, timeout: timeoutMs });
    return {
      sessionId: activeSessionId,
      url: p.url(),
      status: response?.status() ?? null,
      title: await p.title()
    };
  }

  async function screenshot({ fullPage = false, selector = "", sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    let buffer;
    if (selector) {
      const el = await p.$(selector);
      if (!el) throw new Error(`Element not found: ${selector}`);
      buffer = await el.screenshot();
    } else {
      buffer = await p.screenshot({ fullPage });
    }
    return buffer.toString("base64");
  }

  async function click(selector, { timeoutMs = 10000, sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.click(selector, { timeout: timeoutMs });
    return { clicked: selector, url: p.url() };
  }

  async function fill(selector, value, { timeoutMs = 10000, sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.fill(selector, value, { timeout: timeoutMs });
    return { filled: selector };
  }

  async function selectOption(selector, value, { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.selectOption(selector, value);
    return { selected: selector, value };
  }

  async function getText(selector = "body", { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    if (selector === "body" || !selector) {
      return p.evaluate(() => document.body?.innerText ?? "");
    }
    const el = await p.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el.innerText();
  }

  async function getHtml(selector = "", { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    if (!selector) {
      return p.content();
    }
    const el = await p.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el.innerHTML();
  }

  async function getLinks({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    return p.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        text: a.innerText?.trim() ?? "",
        href: a.href,
        rel: a.rel ?? ""
      })).slice(0, 200)
    );
  }

  async function getForms({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    return p.evaluate(() =>
      Array.from(document.querySelectorAll("form")).map((form, i) => ({
        index: i,
        action: form.action,
        method: form.method,
        fields: Array.from(form.elements).map((el) => ({
          name: el.name,
          type: el.type,
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          placeholder: el.placeholder ?? ""
        })).filter((f) => f.name || f.id)
      }))
    );
  }

  async function evaluateJs(expression, { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    // Wrap in async IIFE so statement-style code (let x = 1; return x) works
    const result = await p.evaluate(`(async () => { ${expression} })()`);
    return { result };
  }

  async function getAccessibility({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    const snapshot = await p.accessibility.snapshot();
    return snapshot;
  }

  async function scroll({ direction = "down", amount = 500, sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.evaluate(({ direction, amount }) => {
      if (direction === "down") window.scrollBy(0, amount);
      else if (direction === "up") window.scrollBy(0, -amount);
      else if (direction === "right") window.scrollBy(amount, 0);
      else if (direction === "left") window.scrollBy(-amount, 0);
    }, { direction, amount });
    return { scrolled: direction, amount };
  }

  async function exportPdf(outputPath, { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    const pdfBuffer = await p.pdf({ path: outputPath, format: "A4" });
    return {
      path: outputPath,
      sizeBytes: pdfBuffer.length
    };
  }

  async function getCookies({ sessionId = "" } = {}) {
    const session = await ensureSession({ sessionId });
    const cookies = await session.context.cookies();
    return cookies.map((c) => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure }));
  }

  async function currentUrl({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    return p.url();
  }

  async function goBack({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.goBack();
    return { url: p.url() };
  }

  async function goForward({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.goForward();
    return { url: p.url() };
  }

  async function reload({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.reload();
    return { url: p.url() };
  }

  async function waitForSelector(selector, { timeoutMs = 10000, state = "visible", sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.waitForSelector(selector, { timeout: timeoutMs, state });
    return { ready: selector };
  }

  async function hover(selector, { sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.hover(selector);
    return { hovered: selector };
  }

  async function type(selector, text, { delay = 50, sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    await p.type(selector, text, { delay });
    return { typed: text.length + " chars into " + selector };
  }

  function checkConsoleErrors({ clear = false } = {}) {
    const snapshot = consoleErrors.slice();
    if (clear) consoleErrors.length = 0;
    return snapshot;
  }

  async function keyPress(key, { selector = "", sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    if (selector) {
      await p.locator(selector).press(key);
    } else {
      await p.keyboard.press(key);
    }
    return { pressed: key };
  }

  async function getPageMetrics({ sessionId = "" } = {}) {
    const p = await ensurePage({ sessionId });
    return p.evaluate(() => ({
      domNodes: document.querySelectorAll("*").length,
      scripts: document.querySelectorAll("script").length,
      images: document.querySelectorAll("img").length,
      links: document.querySelectorAll("a").length,
      forms: document.querySelectorAll("form").length,
      inputs: document.querySelectorAll("input, textarea, select").length,
      scrollHeight: document.documentElement.scrollHeight,
      title: document.title,
      url: window.location.href
    }));
  }

  return {
    navigate,
    openSession,
    saveSession,
    closeSession,
    listSessions,
    screenshot,
    click,
    fill,
    selectOption,
    getText,
    getHtml,
    getLinks,
    getForms,
    evaluateJs,
    getAccessibility,
    scroll,
    exportPdf,
    getCookies,
    currentUrl,
    goBack,
    goForward,
    reload,
    waitForSelector,
    hover,
    type,
    keyPress,
    checkConsoleErrors,
    getPageMetrics,
    shutdown,
    get isActive() { return browser !== null; },
    get lastUsedAt() { return lastUsedAt; }
  };
}
