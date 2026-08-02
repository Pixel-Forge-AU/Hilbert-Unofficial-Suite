/**
 * Plugin Name: Browser
 * Plugin Slug: browser
 * Description: Persistent Playwright browser automation with named account sessions, login assistance, and transaction-wrapped web actions.
 * Version: 1.1.0
 * Author: Nova Observer
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createBrowserDaemon } from "./lib/browser-daemon.js";
import { compactText } from "../../observer-general-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeId(value = "", fallback = "default") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizeAccount(input = {}) {
  const service = normalizeId(input.service || input.platform || "web", "web");
  const accountId = normalizeId(input.accountId || input.id || input.username || "default", "default");
  const sessionId = normalizeId(input.sessionId || `${service}:${accountId}`, "default");
  const usernameHandle = compactText(input.usernameHandle || `browser/account/${service}/${accountId}/username`, 240);
  const passwordHandle = compactText(input.passwordHandle || `browser/account/${service}/${accountId}/password`, 240);
  const now = Date.now();
  return {
    id: `${service}:${accountId}`,
    service,
    accountId,
    label: compactText(input.label || `${service} ${accountId}`, 160),
    loginUrl: compactText(input.loginUrl || "", 500),
    verifyUrl: compactText(input.verifyUrl || input.homeUrl || "", 500),
    usernameSelector: compactText(input.usernameSelector || "", 180),
    passwordSelector: compactText(input.passwordSelector || "", 180),
    submitSelector: compactText(input.submitSelector || "", 180),
    successSelector: compactText(input.successSelector || "", 180),
    usernameHandle,
    passwordHandle,
    sessionId,
    status: ["unknown", "configured", "login-required", "logged-in", "failed"].includes(String(input.status || "").trim())
      ? String(input.status).trim()
      : "configured",
    lastVerifiedAt: Number(input.lastVerifiedAt || 0) || 0,
    lastLoginAt: Number(input.lastLoginAt || 0) || 0,
    lastError: compactText(input.lastError || "", 500),
    createdAt: Number(input.createdAt || now) || now,
    updatedAt: Number(input.updatedAt || now) || now
  };
}

function sanitizeAccount(account = {}, extras = {}) {
  return {
    ...account,
    ...extras,
    usernameHandle: account.usernameHandle,
    passwordHandle: account.passwordHandle,
    hasUsername: extras.hasUsername === true,
    hasPassword: extras.hasPassword === true
  };
}

function buildStorageStateKey(account = {}) {
  return `sessions/${normalizeId(account.service, "web")}-${normalizeId(account.accountId, "default")}`;
}

function buildSessionId(args = {}) {
  return normalizeId(args.sessionId || (args.service || args.accountId ? `${args.service || "web"}:${args.accountId || "default"}` : "default"), "default");
}

function pickAccount(state = {}, args = {}) {
  const service = normalizeId(args.service || "", "");
  const accountId = normalizeId(args.accountId || args.id || "", "");
  const ref = normalizeId(args.accountRef || args.account || "", "");
  return (Array.isArray(state.accounts) ? state.accounts : []).find((account) => {
    if (service && accountId) return account.service === service && account.accountId === accountId;
    if (ref) return account.id === ref || account.accountId === ref || account.label.toLowerCase().includes(ref);
    return false;
  }) || null;
}

function inferSelectors(forms = []) {
  const fields = (Array.isArray(forms) ? forms : []).flatMap((form) => Array.isArray(form.fields) ? form.fields : []);
  const cssFor = (field = {}) => {
    if (field.id) return `#${String(field.id).replace(/"/g, '\\"')}`;
    if (field.name) return `[name="${String(field.name).replace(/"/g, '\\"')}"]`;
    return "";
  };
  const username = fields.find((field) =>
    /email|user|login|account/i.test(`${field.name || ""} ${field.id || ""} ${field.placeholder || ""}`)
    && !/hidden|submit|button|password/i.test(String(field.type || ""))
  ) || fields.find((field) => /email|text/i.test(String(field.type || "")));
  const password = fields.find((field) => /password/i.test(String(field.type || "")));
  return {
    usernameSelector: cssFor(username),
    passwordSelector: cssFor(password),
    submitSelector: "button[type='submit'], input[type='submit']"
  };
}

async function maybeCompleteTransaction(coreTransactions, txnId = "", result = {}) {
  if (!coreTransactions || !txnId) return null;
  return await coreTransactions.completeExternalTransaction(txnId, result).catch(() => null);
}

// Secret storage is delegated to the secrets plugin's capabilities rather than the Nova-era
// runtimeContext secret functions, which nothing in Genesis ever populates.
async function hasSecretValue(api, handle = "") {
  const hasSecret = api.getCapability("secrets:has");
  return typeof hasSecret === "function" ? Boolean(await hasSecret({ handle })) : false;
}

async function getSecretValue(api, handle = "") {
  const getSecret = api.getCapability("secrets:get");
  return typeof getSecret === "function" ? String((await getSecret({ handle })) || "") : "";
}

async function setSecretValue(api, handle = "", value = "") {
  const setSecret = api.getCapability("secrets:set");
  if (typeof setSecret !== "function") {
    throw new Error("secrets plugin is not available to store browser account credentials");
  }
  return setSecret({ handle, value });
}

export function createBrowserPlugin(options = {}) {
  const {
    pluginId = "browser",
    pluginName = "Browser",
    description = "Playwright browser automation for workers, including reusable website account sessions."
  } = options;

  let daemon = null;

  function getDaemon() {
    if (!daemon) daemon = createBrowserDaemon();
    return daemon;
  }

  const readState = async (api) => {
    if (!api.data) return { version: 1, accounts: [] };
    const saved = await api.data.readJson("accounts", {});
    return {
      version: 1,
      accounts: Array.isArray(saved?.accounts) ? saved.accounts.map(normalizeAccount) : []
    };
  };

  const writeState = async (api, state = {}) => {
    const normalized = {
      version: 1,
      accounts: Array.isArray(state.accounts) ? state.accounts.map(normalizeAccount) : []
    };
    if (api.data) await api.data.writeJson("accounts", normalized);
    return normalized;
  };

  const listAccounts = async (api) => {
    const state = await readState(api);
    return await Promise.all(state.accounts.map(async (account) => sanitizeAccount(account, {
      hasUsername: await hasSecretValue(api, account.usernameHandle),
      hasPassword: await hasSecretValue(api, account.passwordHandle),
      storageStatePath: api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || ""
    })));
  };

  const saveAccount = async (api, input = {}) => {
    const state = await readState(api);
    const now = Date.now();
    const existing = pickAccount(state, input);
    const account = normalizeAccount({ ...(existing || {}), ...input, updatedAt: now });
    const username = String(input.username || "").trim();
    const password = String(input.password || "");
    if (username) await setSecretValue(api, account.usernameHandle, username);
    if (password) await setSecretValue(api, account.passwordHandle, password);
    const index = state.accounts.findIndex((entry) => entry.id === account.id);
    if (index >= 0) state.accounts[index] = account;
    else state.accounts.push(account);
    await writeState(api, state);
    return sanitizeAccount(account, {
      hasUsername: Boolean(username) || await hasSecretValue(api, account.usernameHandle).catch(() => false),
      hasPassword: Boolean(password) || await hasSecretValue(api, account.passwordHandle).catch(() => false),
      storageStatePath: api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || ""
    });
  };

  const openAccountSession = async (api, args = {}) => {
    const state = await readState(api);
    const account = pickAccount(state, args);
    if (!account) throw new Error("account not found");
    const storageStatePath = api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || "";
    const result = await getDaemon().openSession({
      sessionId: account.sessionId,
      storageStatePath,
      visible: args.visible === true,
      url: String(args.url || account.verifyUrl || account.loginUrl || "").trim()
    });
    return { ...result, account: sanitizeAccount(account, { storageStatePath }) };
  };

  const saveAccountSession = async (api, args = {}) => {
    const state = await readState(api);
    const account = pickAccount(state, args);
    if (!account) throw new Error("account not found");
    const storageStatePath = api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || "";
    const saved = await getDaemon().saveSession({ sessionId: account.sessionId, storageStatePath });
    account.status = "logged-in";
    account.lastVerifiedAt = Date.now();
    account.updatedAt = Date.now();
    const index = state.accounts.findIndex((entry) => entry.id === account.id);
    if (index >= 0) state.accounts[index] = account;
    await writeState(api, state);
    return { ...saved, account: sanitizeAccount(account, { storageStatePath }) };
  };

  const verifyAccountSession = async (api, args = {}) => {
    const state = await readState(api);
    const account = pickAccount(state, args);
    if (!account) throw new Error("account not found");
    const storageStatePath = api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || "";
    const daemonInstance = getDaemon();
    const targetUrl = String(args.url || account.verifyUrl || account.loginUrl || "").trim();
    if (targetUrl) await daemonInstance.navigate(targetUrl, { sessionId: account.sessionId, storageStatePath, timeoutMs: Number(args.timeoutMs || 30000) });
    const currentUrl = await daemonInstance.currentUrl({ sessionId: account.sessionId });
    const title = await daemonInstance.getPageMetrics({ sessionId: account.sessionId }).then((m) => m.title).catch(() => "");
    const text = await daemonInstance.getText("body", { sessionId: account.sessionId }).catch(() => "");
    const successSelector = String(args.successSelector || account.successSelector || "").trim();
    let verified = false;
    if (successSelector) {
      verified = await daemonInstance.waitForSelector(successSelector, { sessionId: account.sessionId, timeoutMs: Number(args.timeoutMs || 5000) }).then(() => true).catch(() => false);
    } else {
      verified = !/\b(sign in|log in|login|password|forgot password)\b/i.test(`${title}\n${text.slice(0, 1200)}`);
    }
    account.status = verified ? "logged-in" : "login-required";
    account.lastVerifiedAt = Date.now();
    account.lastError = verified ? "" : "Login screen or password prompt appears to be present.";
    account.updatedAt = Date.now();
    const index = state.accounts.findIndex((entry) => entry.id === account.id);
    if (index >= 0) state.accounts[index] = account;
    await writeState(api, state);
    return { verified, url: currentUrl, title, account: sanitizeAccount(account, { storageStatePath }) };
  };

  const loginAccount = async (api, args = {}) => {
    const state = await readState(api);
    const account = pickAccount(state, args);
    if (!account) throw new Error("account not found");
    const username = String(args.username || await getSecretValue(api, account.usernameHandle) || "").trim();
    const password = String(args.password || await getSecretValue(api, account.passwordHandle) || "");
    const storageStatePath = api.data?.path?.(buildStorageStateKey(account), { extension: ".json" }) || "";
    const d = getDaemon();
    const loginUrl = String(args.loginUrl || account.loginUrl || "").trim();
    if (!loginUrl) throw new Error("loginUrl is required");
    await d.openSession({ sessionId: account.sessionId, storageStatePath, visible: args.visible === true, url: loginUrl });
    if (!username || !password) {
      account.status = "login-required";
      account.lastError = "Missing username or password secret.";
      account.updatedAt = Date.now();
      await writeState(api, state);
      return {
        ok: false,
        manualRequired: true,
        reason: "missing_credentials",
        message: "Username/password secrets are missing. Open the visible session or save credentials, then retry.",
        account: sanitizeAccount(account, { storageStatePath })
      };
    }

    let usernameSelector = String(args.usernameSelector || account.usernameSelector || "").trim();
    let passwordSelector = String(args.passwordSelector || account.passwordSelector || "").trim();
    let submitSelector = String(args.submitSelector || account.submitSelector || "").trim();
    if (!usernameSelector || !passwordSelector) {
      const inferred = inferSelectors(await d.getForms({ sessionId: account.sessionId }).catch(() => []));
      usernameSelector ||= inferred.usernameSelector;
      passwordSelector ||= inferred.passwordSelector;
      submitSelector ||= inferred.submitSelector;
    }
    if (!usernameSelector || !passwordSelector) {
      account.status = "login-required";
      account.lastError = "Could not infer login form selectors.";
      account.updatedAt = Date.now();
      await writeState(api, state);
      return {
        ok: false,
        manualRequired: true,
        reason: "selectors_required",
        message: "Could not find username/password fields. Complete login manually or provide selectors.",
        account: sanitizeAccount(account, { storageStatePath })
      };
    }

    await d.fill(usernameSelector, username, { sessionId: account.sessionId, timeoutMs: Number(args.timeoutMs || 10000) });
    await d.fill(passwordSelector, password, { sessionId: account.sessionId, timeoutMs: Number(args.timeoutMs || 10000) });
    if (submitSelector) {
      await d.click(submitSelector, { sessionId: account.sessionId, timeoutMs: Number(args.timeoutMs || 10000) });
    } else {
      await d.keyPress("Enter", { sessionId: account.sessionId, selector: passwordSelector });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.min(Number(args.waitMs || 3500), 15000))));
    const verifiedResult = await verifyAccountSession(api, { service: account.service, accountId: account.accountId, timeoutMs: 5000 }).catch((error) => ({ verified: false, error: String(error?.message || error) }));
    if (verifiedResult.verified) {
      await saveAccountSession(api, { service: account.service, accountId: account.accountId });
      account.status = "logged-in";
      account.lastLoginAt = Date.now();
      account.lastError = "";
    } else {
      account.status = "login-required";
      account.lastError = compactText(verifiedResult.error || "Login may need MFA, CAPTCHA, or manual confirmation.", 500);
    }
    account.updatedAt = Date.now();
    const index = state.accounts.findIndex((entry) => entry.id === account.id);
    if (index >= 0) state.accounts[index] = account;
    await writeState(api, state);
    return {
      ok: account.status === "logged-in",
      manualRequired: account.status !== "logged-in",
      message: account.status === "logged-in" ? "Login succeeded and session was saved." : "Login needs manual completion or extra verification.",
      account: sanitizeAccount(account, { storageStatePath }),
      verified: verifiedResult
    };
  };

  const runBrowserExternalAction = async (api, args = {}) => {
    const runtime = api.getRuntimeContext?.() || {};
    const coreTransactions = runtime.coreTransactions || null;
    const action = String(args.action || "").trim();
    const target = String(args.target || args.selector || args.url || "").trim();
    if (!action) throw new Error("action is required");
    let txnId = "";
    if (coreTransactions && typeof coreTransactions.proposeExternalSideEffectTransaction === "function") {
      const txn = await coreTransactions.proposeExternalSideEffectTransaction({
        pluginId: "browser",
        domain: "browser",
        operation: `browser_${action}`,
        target,
        summary: compactText(args.summary || `Browser ${action} on ${target || "current page"}`, 220),
        irreversible: args.irreversible !== false,
        compensationPlan: compactText(args.compensationPlan || "Use the website UI to undo or delete the created external change when supported.", 1000),
        requiresApproval: args.requiresApproval !== false,
        riskLevel: String(args.riskLevel || "high").trim(),
        riskReasons: ["external_website", action],
        payload: {
          action,
          selector: args.selector,
          url: args.url,
          valuePreview: compactText(args.value || args.text || args.body || "", 500),
          service: args.service,
          accountId: args.accountId,
          sessionId: args.sessionId
        }
      }, {
        taskId: String(args.taskContext?.taskId || args.taskId || "").trim(),
        toolCallId: String(args.toolCallId || "").trim()
      }).catch(() => null);
      txnId = String(txn?.id || "").trim();
      if (args.proposeOnly === true) {
        return { pendingApproval: true, transactionId: txnId, transaction: txn };
      }
    }
    try {
      const d = getDaemon();
      const sessionId = buildSessionId(args);
      if (args.service || args.accountId || args.accountRef || args.account) {
        await openAccountSession(api, { ...args, visible: args.visible === true, url: "" });
      }
      let result = null;
      if (action === "navigate") result = await d.navigate(String(args.url || target || ""), { sessionId, timeoutMs: Number(args.timeoutMs || 30000) });
      else if (action === "click") result = await d.click(String(args.selector || target || ""), { sessionId, timeoutMs: Number(args.timeoutMs || 10000) });
      else if (action === "fill") result = await d.fill(String(args.selector || ""), String(args.value || args.text || ""), { sessionId, timeoutMs: Number(args.timeoutMs || 10000) });
      else if (action === "type") result = await d.type(String(args.selector || ""), String(args.value || args.text || ""), { sessionId, delay: Number(args.delay || 50) });
      else if (action === "press") result = await d.keyPress(String(args.key || "Enter"), { sessionId, selector: String(args.selector || "") });
      else if (action === "evaluate") result = await d.evaluateJs(String(args.expression || args.js || ""), { sessionId });
      else throw new Error(`unsupported browser external action: ${action}`);
      await maybeCompleteTransaction(coreTransactions, txnId, { ok: true, actor: "worker", notes: `Browser action completed: ${action}` });
      return { ok: true, transactionId: txnId, result };
    } catch (error) {
      await maybeCompleteTransaction(coreTransactions, txnId, { ok: false, actor: "worker", error: String(error?.message || error), failureClass: "browser_action_failed" });
      throw error;
    }
  };

  async function handleToolCall(api, payload = {}) {
    const name = String(payload?.name || "").trim();
    const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    const d = getDaemon();

    try {
      let result;

      if (name === "browser_save_account") {
        result = await saveAccount(api, args);
      } else if (name === "browser_list_accounts") {
        result = { accounts: await listAccounts(api) };
      } else if (name === "browser_open_session") {
        if (args.service || args.accountId || args.accountRef || args.account) result = await openAccountSession(api, args);
        else result = await d.openSession({ sessionId: buildSessionId(args), visible: args.visible === true, url: String(args.url || "").trim() });
      } else if (name === "browser_save_session") {
        if (args.service || args.accountId || args.accountRef || args.account) result = await saveAccountSession(api, args);
        else result = await d.saveSession({ sessionId: buildSessionId(args), storageStatePath: String(args.storageStatePath || "").trim() });
      } else if (name === "browser_verify_session") {
        result = await verifyAccountSession(api, args);
      } else if (name === "browser_login") {
        result = await loginAccount(api, args);
      } else if (name === "browser_external_action") {
        result = await runBrowserExternalAction(api, args);
      } else if (name === "browser_navigate") {
        const url = String(args.url || "").trim();
        if (!url) throw new Error("url is required");
        result = await d.navigate(url, { waitUntil: args.waitUntil || "domcontentloaded", timeoutMs: Number(args.timeoutMs || 30000), sessionId: buildSessionId(args), visible: args.visible === true });
      } else if (name === "browser_screenshot") {
        const base64 = await d.screenshot({ fullPage: args.fullPage === true, selector: String(args.selector || "").trim(), sessionId: buildSessionId(args) });
        result = { base64, format: "png", length: base64.length };
      } else if (name === "browser_click") {
        const selector = String(args.selector || "").trim();
        if (!selector) throw new Error("selector is required");
        result = await d.click(selector, { timeoutMs: Number(args.timeoutMs || 10000), sessionId: buildSessionId(args) });
      } else if (name === "browser_fill") {
        const selector = String(args.selector || "").trim();
        const value = String(args.value ?? "");
        if (!selector) throw new Error("selector is required");
        result = await d.fill(selector, value, { timeoutMs: Number(args.timeoutMs || 10000), sessionId: buildSessionId(args) });
      } else if (name === "browser_get_text") {
        const selector = String(args.selector || "body").trim();
        const text = await d.getText(selector, { sessionId: buildSessionId(args) });
        result = { text: text.slice(0, 8000), truncated: text.length > 8000, charCount: text.length };
      } else if (name === "browser_get_html") {
        const selector = String(args.selector || "").trim();
        const html = await d.getHtml(selector, { sessionId: buildSessionId(args) });
        result = { html: html.slice(0, 12000), truncated: html.length > 12000, charCount: html.length };
      } else if (name === "browser_get_links") {
        result = { links: await d.getLinks({ sessionId: buildSessionId(args) }) };
      } else if (name === "browser_get_forms") {
        result = { forms: await d.getForms({ sessionId: buildSessionId(args) }) };
      } else if (name === "browser_evaluate_js") {
        const expression = String(args.expression || args.js || "").trim();
        if (!expression) throw new Error("expression is required");
        result = await d.evaluateJs(expression, { sessionId: buildSessionId(args) });
      } else if (name === "browser_scroll") {
        result = await d.scroll({ direction: String(args.direction || "down").trim(), amount: Number(args.amount || 500), sessionId: buildSessionId(args) });
      } else if (name === "browser_hover") {
        const selector = String(args.selector || "").trim();
        if (!selector) throw new Error("selector is required");
        result = await d.hover(selector, { sessionId: buildSessionId(args) });
      } else if (name === "browser_type") {
        const selector = String(args.selector || "").trim();
        const text = String(args.text || "");
        if (!selector) throw new Error("selector is required");
        result = await d.type(selector, text, { delay: Number(args.delay || 50), sessionId: buildSessionId(args) });
      } else if (name === "browser_select") {
        const selector = String(args.selector || "").trim();
        const value = String(args.value || "").trim();
        if (!selector) throw new Error("selector is required");
        result = await d.selectOption(selector, value, { sessionId: buildSessionId(args) });
      } else if (name === "browser_wait_for") {
        const selector = String(args.selector || "").trim();
        if (!selector) throw new Error("selector is required");
        result = await d.waitForSelector(selector, { timeoutMs: Number(args.timeoutMs || 10000), state: String(args.state || "visible"), sessionId: buildSessionId(args) });
      } else if (name === "browser_go_back") {
        result = await d.goBack({ sessionId: buildSessionId(args) });
      } else if (name === "browser_go_forward") {
        result = await d.goForward({ sessionId: buildSessionId(args) });
      } else if (name === "browser_reload") {
        result = await d.reload({ sessionId: buildSessionId(args) });
      } else if (name === "browser_get_cookies") {
        result = { cookies: await d.getCookies({ sessionId: buildSessionId(args) }) };
      } else if (name === "browser_get_metrics") {
        result = await d.getPageMetrics({ sessionId: buildSessionId(args) });
      } else if (name === "browser_export_pdf") {
        const outputPath = String(args.path || args.outputPath || "").trim();
        if (!outputPath) throw new Error("path is required");
        result = await d.exportPdf(outputPath, { sessionId: buildSessionId(args) });
      } else if (name === "browser_current_url") {
        result = { url: await d.currentUrl({ sessionId: buildSessionId(args) }) };
      } else if (name === "browser_shutdown") {
        await d.shutdown();
        daemon = null;
        result = { shutdown: true };
      } else if (name === "browser_key_press") {
        const key = String(args.key || "").trim();
        if (!key) throw new Error("key is required");
        result = await d.keyPress(key, { selector: String(args.selector || "").trim(), sessionId: buildSessionId(args) });
      } else if (name === "browser_get_console_errors") {
        const errors = d.checkConsoleErrors({ clear: args.clear === true });
        result = { errors, count: errors.length };
      } else if (name === "browser_get_accessibility") {
        result = { snapshot: await d.getAccessibility({ sessionId: buildSessionId(args) }) };
      } else {
        return payload;
      }

      return { ...payload, handled: true, result };
    } catch (error) {
      return {
        ...payload,
        handled: true,
        result: {
          error: true,
          message: String(error?.message || error || "browser error"),
          hint: error?.message?.includes("not installed")
            ? "Install Playwright: cd nova-observer && npm install playwright && npx playwright install chromium"
            : undefined
        }
      };
    }
  }

  const TOOL_DEFINITIONS = [
    { name: "browser_save_account", description: "Save website account metadata for reusable browser sessions. Username/password values are stored in the core secrets store, not plugin data.", scopes: ["worker"], risk: "high", parameters: { service: "string", accountId: "string", label: "string", loginUrl: "string", verifyUrl: "string", username: "string", password: "string", usernameSelector: "string", passwordSelector: "string", submitSelector: "string", successSelector: "string" } },
    { name: "browser_list_accounts", description: "List browser-managed website accounts and whether their core secret handles are populated.", scopes: ["worker", "intake"], risk: "normal", parameters: {} },
    { name: "browser_open_session", description: "Open a named browser session or account session. Pass visible:true for human-assisted login flows.", scopes: ["worker"], risk: "normal", parameters: { sessionId: "string", service: "string", accountId: "string", url: "string", visible: "boolean" } },
    { name: "browser_save_session", description: "Persist cookies/localStorage for an open browser account session.", scopes: ["worker"], risk: "high", parameters: { sessionId: "string", service: "string", accountId: "string" } },
    { name: "browser_verify_session", description: "Verify that an account session appears logged in, using a success selector or login-screen heuristic.", scopes: ["worker"], risk: "normal", parameters: { service: "string", accountId: "string", url: "string", successSelector: "string" } },
    { name: "browser_login", description: "Attempt automatic website login using core-stored credentials. Falls back with manualRequired when MFA/CAPTCHA/selectors block automation.", scopes: ["worker"], risk: "high", parameters: { service: "string", accountId: "string", visible: "boolean", usernameSelector: "string", passwordSelector: "string", submitSelector: "string", successSelector: "string" } },
    { name: "browser_external_action", description: "Run an external website action through the transaction ledger before executing it in a browser session.", scopes: ["worker"], risk: "high", parameters: { action: "navigate|click|fill|type|press|evaluate", service: "string", accountId: "string", sessionId: "string", selector: "string", url: "string", value: "string", key: "string", expression: "string", summary: "string", proposeOnly: "boolean" } },
    { name: "browser_navigate", description: "Navigate the browser to a URL. Supports sessionId or service/accountId.", scopes: ["worker"], parameters: { url: "string", sessionId: "string", service: "string", accountId: "string", waitUntil: "domcontentloaded|load|networkidle", timeoutMs: "number", visible: "boolean" } },
    { name: "browser_screenshot", description: "Take a screenshot of the current page. Returns base64-encoded PNG.", scopes: ["worker"], parameters: { fullPage: "boolean", selector: "string", sessionId: "string" } },
    { name: "browser_click", description: "Click an element by CSS selector or text locator.", scopes: ["worker"], parameters: { selector: "string", sessionId: "string", timeoutMs: "number" } },
    { name: "browser_fill", description: "Fill an input or textarea with a value.", scopes: ["worker"], parameters: { selector: "string", value: "string", sessionId: "string", timeoutMs: "number" } },
    { name: "browser_get_text", description: "Extract visible text from the page or a specific element. Returns up to 8000 characters.", scopes: ["worker"], parameters: { selector: "string", sessionId: "string" } },
    { name: "browser_get_html", description: "Get the HTML source of the page or a specific element. Returns up to 12000 characters.", scopes: ["worker"], parameters: { selector: "string", sessionId: "string" } },
    { name: "browser_get_links", description: "Extract hyperlinks from the current page.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_get_forms", description: "List forms on the page with their fields, actions, and methods.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_evaluate_js", description: "Execute JavaScript in the browser page context and return the result.", scopes: ["worker"], parameters: { expression: "string", sessionId: "string" } },
    { name: "browser_scroll", description: "Scroll the page in a direction.", scopes: ["worker"], parameters: { direction: "up|down|left|right", amount: "number", sessionId: "string" } },
    { name: "browser_hover", description: "Hover over an element.", scopes: ["worker"], parameters: { selector: "string", sessionId: "string" } },
    { name: "browser_type", description: "Type text character by character into an element.", scopes: ["worker"], parameters: { selector: "string", text: "string", delay: "number", sessionId: "string" } },
    { name: "browser_select", description: "Select an option in a select dropdown.", scopes: ["worker"], parameters: { selector: "string", value: "string", sessionId: "string" } },
    { name: "browser_wait_for", description: "Wait until a selector appears on the page.", scopes: ["worker"], parameters: { selector: "string", state: "visible|hidden|attached", timeoutMs: "number", sessionId: "string" } },
    { name: "browser_go_back", description: "Navigate back in browser history.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_go_forward", description: "Navigate forward in browser history.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_reload", description: "Reload the current page.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_get_cookies", description: "Get redacted cookie metadata for the current page context.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_get_metrics", description: "Get page metrics: DOM node count, title, URL, forms, inputs, and page shape.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_export_pdf", description: "Export the current page as a PDF file.", scopes: ["worker"], parameters: { path: "string", sessionId: "string" } },
    { name: "browser_current_url", description: "Get the current page URL.", scopes: ["worker"], parameters: { sessionId: "string" } },
    { name: "browser_shutdown", description: "Shut down the browser daemon to free resources.", scopes: ["worker"], parameters: {} },
    { name: "browser_key_press", description: "Press a keyboard key, optionally focused on an element.", scopes: ["worker"], parameters: { key: "string", selector: "string", sessionId: "string" } },
    { name: "browser_get_console_errors", description: "Return JavaScript console errors captured since browser startup.", scopes: ["worker"], parameters: { clear: "boolean" } },
    { name: "browser_get_accessibility", description: "Return the ARIA accessibility tree snapshot.", scopes: ["worker"], parameters: { sessionId: "string" } }
  ];

  return {
    id: pluginId,
    name: pluginName,
    version: "1.1.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
        capabilities: [
          "browser.daemon",
          "browser.accounts.list",
          "browser.accounts.save",
          "browser.session.open",
          "browser.session.save",
          "browser.session.verify",
          "browser.login",
          "browser.externalAction"
        ],
        hooks: ["intake:tool-call"],
        runtimeContext: [
          "coreTransactions",
          "noteInteractiveActivity"
        ]
      },
      dependencies: { requiredCapabilities: [], optionalCapabilities: ["secrets:get", "secrets:set", "secrets:has"] },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) api.registerTool(tool);
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("browser.daemon", () => getDaemon(), { priority: 10 });
        api.provideCapability("browser.accounts.list", () => listAccounts(api), { priority: 10 });
        api.provideCapability("browser.accounts.save", (input = {}) => saveAccount(api, input), { priority: 10 });
        api.provideCapability("browser.session.open", (input = {}) => openAccountSession(api, input), { priority: 10 });
        api.provideCapability("browser.session.save", (input = {}) => saveAccountSession(api, input), { priority: 10 });
        api.provideCapability("browser.session.verify", (input = {}) => verifyAccountSession(api, input), { priority: 10 });
        api.provideCapability("browser.login", (input = {}) => loginAccount(api, input), { priority: 10 });
        api.provideCapability("browser.externalAction", (input = {}) => runBrowserExternalAction(api, input), { priority: 10 });
      }

      if (typeof api.addHook === "function") {
        api.addHook("intake:tool-call", (payload = {}) => handleToolCall(api, payload));
      }
    },

    async registerRoutes({ app, api }) {
      if (!app || typeof api?.canRegisterRoutes !== "function" || !api.canRegisterRoutes()) return;

      app.get("/api/plugin/browser/status", async (_req, res) => {
        res.json({
          ok: true,
          active: daemon?.isActive ?? false,
          lastUsedAt: daemon?.lastUsedAt ?? 0,
          sessions: daemon?.listSessions?.() || []
        });
      });

      app.get("/api/plugin/browser/accounts", async (_req, res) => {
        try {
          res.json({ ok: true, accounts: await listAccounts(api) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list browser accounts") });
        }
      });

      app.post("/api/plugin/browser/accounts", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          res.json({ ok: true, account: await saveAccount(api, req.body || {}) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save browser account") });
        }
      });

      app.post("/api/plugin/browser/accounts/login", async (req, res) => {
        try {
          api.getRuntimeContext?.()?.noteInteractiveActivity?.();
          res.json({ ok: true, ...(await loginAccount(api, req.body || {})) });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to login browser account") });
        }
      });

      app.post("/api/plugin/browser/shutdown", async (_req, res) => {
        if (daemon) {
          await daemon.shutdown();
          daemon = null;
        }
        res.json({ ok: true, shutdown: true });
      });
    }
  };
}

export default createBrowserPlugin;
