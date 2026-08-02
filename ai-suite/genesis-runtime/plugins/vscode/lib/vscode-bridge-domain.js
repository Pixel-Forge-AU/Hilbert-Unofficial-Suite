import crypto from "node:crypto";

const SETTINGS_KEY = "settings";
const REQUESTS_KEY = "edit-requests";
const MAX_TEXT_CHARS = 120000;

function nowMs() {
  return Date.now();
}

function compactText(value = "", maxLength = 2000) {
  const normalized = String(value ?? "").replace(/\r/g, "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 20)).trim()}\n...[truncated]`;
}

function normalizeId(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  if (normalized.length > 128) throw new Error("ID exceeds maximum allowed length of 128 characters");
  return normalized || fallback;
}

function normalizePath(value = "") {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (/\.\./.test(normalized)) throw new Error("Path contains invalid traversal sequences");
  if (normalized.length > 4096) throw new Error("Path exceeds maximum allowed length of 4096 characters");
  return normalized;
}

function normalizeInteger(value, fallback, min, max) {
  if (String(value ?? "").trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(integer, max));
}

function normalizeEditor(entry = {}) {
  const path = normalizePath(entry.path || entry.file || entry.uri || entry.filePath);
  if (!path) {
    return null;
  }
  const text = Object.prototype.hasOwnProperty.call(entry, "text")
    ? compactText(entry.text, MAX_TEXT_CHARS)
    : undefined;
  return {
    path,
    languageId: String(entry.languageId || entry.language || "").trim(),
    isDirty: entry.isDirty === true,
    selection: entry.selection && typeof entry.selection === "object" ? entry.selection : null,
    visibleRanges: Array.isArray(entry.visibleRanges) ? entry.visibleRanges.slice(0, 12) : [],
    text,
    textLength: typeof text === "string" ? text.length : Number(entry.textLength || 0)
  };
}

function normalizeFileEntry(entry = {}) {
  const path = normalizePath(entry.path || entry.file || entry.uri || entry.filePath);
  if (!path) {
    return null;
  }
  return {
    path,
    type: String(entry.type || (entry.isDirectory ? "directory" : "file")).trim().toLowerCase() || "file",
    size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : null,
    mtime: Number.isFinite(Number(entry.mtime)) ? Number(entry.mtime) : null
  };
}

function normalizeDiagnostic(entry = {}) {
  const path = normalizePath(entry.path || entry.file || entry.uri || entry.filePath);
  const message = compactText(entry.message || entry.text || "", 500);
  if (!path && !message) {
    return null;
  }
  return {
    path,
    message,
    severity: String(entry.severity || "info").trim().toLowerCase(),
    source: String(entry.source || "").trim(),
    code: String(entry.code || "").trim(),
    range: entry.range && typeof entry.range === "object" ? entry.range : null
  };
}

function normalizeGit(git = {}) {
  return {
    branch: String(git.branch || "").trim(),
    head: String(git.head || git.sha || "").trim(),
    state: String(git.state || "").trim(),
    statusText: compactText(git.statusText || git.status || "", 12000),
    changedFiles: Array.isArray(git.changedFiles)
      ? git.changedFiles.map((entry) => typeof entry === "string" ? { path: normalizePath(entry) } : {
          path: normalizePath(entry.path || entry.file),
          status: String(entry.status || "").trim()
        }).filter((entry) => entry.path).slice(0, 500)
      : [],
    diffSummary: compactText(git.diffSummary || "", 12000)
  };
}

function summarizeSession(session = {}) {
  const snapshot = session.snapshot || {};
  return {
    sessionId: session.sessionId || "",
    workspaceName: snapshot.workspaceName || "",
    workspaceFolders: snapshot.workspaceFolders || [],
    activeFile: snapshot.activeEditor?.path || "",
    openEditorCount: Array.isArray(snapshot.openEditors) ? snapshot.openEditors.length : 0,
    fileCount: Array.isArray(snapshot.files) ? snapshot.files.length : 0,
    diagnosticCount: Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics.length : 0,
    gitBranch: snapshot.git?.branch || "",
    updatedAt: session.updatedAt || 0,
    pendingRequestCount: Array.isArray(session.pendingRequests) ? session.pendingRequests.filter((entry) => entry.status === "pending").length : 0
  };
}

function getBearerToken(req = {}) {
  const auth = String(req.headers?.authorization || "").trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return String(req.headers?.["x-nova-vscode-token"] || req.query?.token || "").trim();
}

function isLoopbackRequest(req = {}) {
  const ip = String(req.ip || req.socket?.remoteAddress || "").trim();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"].includes(ip) || ip.endsWith("127.0.0.1");
}

export function createVSCodeBridgeDomain({ data = null, coreTransactions = null } = {}) {
  const sessions = new Map();

  async function ensureSettings() {
    const existing = data ? await data.readJson(SETTINGS_KEY, null).catch(() => null) : null;
    if (existing?.pairingToken) {
      return existing;
    }
    const settings = {
      pairingToken: crypto.randomBytes(24).toString("hex"),
      createdAt: nowMs()
    };
    if (data) {
      await data.writeJson(SETTINGS_KEY, settings);
    }
    return settings;
  }

  async function loadRequestState() {
    const existing = data ? await data.readJson(REQUESTS_KEY, null).catch(() => null) : null;
    return {
      requests: Array.isArray(existing?.requests) ? existing.requests : []
    };
  }

  async function saveRequestState(state = {}) {
    const normalized = {
      schemaVersion: 1,
      updatedAt: nowMs(),
      requests: Array.isArray(state?.requests) ? state.requests.slice(-500) : []
    };
    if (data) {
      await data.writeJson(REQUESTS_KEY, normalized);
    }
    return normalized;
  }

  async function listDurableRequests(filter = {}) {
    const state = await loadRequestState();
    const sessionId = String(filter.sessionId || "").trim();
    const status = String(filter.status || "").trim();
    return state.requests.filter((entry) =>
      (!sessionId || String(entry.sessionId || "").trim() === sessionId)
      && (!status || String(entry.status || "").trim() === status)
    );
  }

  async function verifyToken(token = "") {
    const settings = await ensureSettings();
    return Boolean(String(token || "").trim() && String(token).trim() === settings.pairingToken);
  }

  async function requireToken(token = "") {
    if (!(await verifyToken(token))) {
      const error = new Error("invalid or missing VS Code bridge token");
      error.statusCode = 403;
      throw error;
    }
  }

  function pickSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (normalizedSessionId && sessions.has(normalizedSessionId)) {
      return sessions.get(normalizedSessionId);
    }
    return [...sessions.values()].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0] || null;
  }

  async function getPairingInfo(req = {}) {
    if (!isLoopbackRequest(req)) {
      const error = new Error("pairing token is only available to loopback requests");
      error.statusCode = 403;
      throw error;
    }
    const settings = await ensureSettings();
    return {
      pairingToken: settings.pairingToken,
      createdAt: settings.createdAt || 0
    };
  }

  function getStatus() {
    const list = [...sessions.values()].map(summarizeSession);
    return {
      connected: list.length > 0,
      sessions: list
    };
  }

  async function upsertSnapshot(payload = {}, token = "") {
    await requireToken(token);
    const sessionId = normalizeId(payload.sessionId, "default");
    const activeEditor = normalizeEditor(payload.activeEditor || payload.activeTextEditor || {});
    const openEditors = (Array.isArray(payload.openEditors) ? payload.openEditors : [])
      .map(normalizeEditor)
      .filter(Boolean)
      .slice(0, 80);
    const files = (Array.isArray(payload.files) ? payload.files : Array.isArray(payload.workspaceFiles) ? payload.workspaceFiles : [])
      .map(normalizeFileEntry)
      .filter(Boolean)
      .slice(0, 5000);
    const diagnostics = (Array.isArray(payload.diagnostics) ? payload.diagnostics : [])
      .map(normalizeDiagnostic)
      .filter(Boolean)
      .slice(0, 1000);
    const fileContents = {};
    const rawFileContents = payload.fileContents && typeof payload.fileContents === "object" ? payload.fileContents : {};
    for (const [path, text] of Object.entries(rawFileContents)) {
      const normalizedPath = normalizePath(path);
      if (normalizedPath) {
        fileContents[normalizedPath] = compactText(text, MAX_TEXT_CHARS);
      }
    }
    for (const editor of [activeEditor, ...openEditors].filter(Boolean)) {
      if (typeof editor.text === "string") {
        fileContents[editor.path] = editor.text;
      }
    }

    const durablePending = await listDurableRequests({ sessionId, status: "pending" });
    const previous = sessions.get(sessionId) || { pendingRequests: [] };
    const snapshot = {
      sessionId,
      workspaceName: String(payload.workspaceName || "").trim(),
      workspaceFolders: Array.isArray(payload.workspaceFolders)
        ? payload.workspaceFolders.map(normalizePath).filter(Boolean).slice(0, 20)
        : [],
      activeEditor,
      openEditors,
      files,
      diagnostics,
      git: normalizeGit(payload.git || {}),
      fileContents,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map((entry) => String(entry || "").trim()).filter(Boolean) : []
    };
    const session = {
      sessionId,
      snapshot,
      pendingRequests: (() => {
        const durableIds = new Set(durablePending.map((r) => r.id));
        const inMemoryOnly = (Array.isArray(previous.pendingRequests) ? previous.pendingRequests : [])
          .filter((r) => r.status === "pending" && !durableIds.has(r.id));
        return [...durablePending, ...inMemoryOnly];
      })(),
      updatedAt: nowMs()
    };
    sessions.set(sessionId, session);
    return summarizeSession(session);
  }

  function getContext(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", connected: false };
    }
    const snapshot = session.snapshot || {};
    const includeOpenEditors = args.includeOpenEditors !== false;
    return {
      text: `VS Code is connected to ${snapshot.workspaceName || "a workspace"}. Active file: ${snapshot.activeEditor?.path || "none"}.`,
      connected: true,
      summary: summarizeSession(session),
      workspaceFolders: snapshot.workspaceFolders || [],
      activeEditor: snapshot.activeEditor || null,
      openEditors: includeOpenEditors ? (snapshot.openEditors || []).map((entry) => ({ ...entry, text: undefined })) : [],
      diagnostics: (snapshot.diagnostics || []).slice(0, normalizeInteger(args.diagnosticLimit ?? 50, 50, 1, 500)),
      git: snapshot.git || {}
    };
  }

  function listFiles(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", files: [] };
    }
    const query = String(args.query || args.contains || "").trim().toLowerCase();
    const limit = normalizeInteger(args.limit ?? 200, 200, 1, 1000);
    const files = (session.snapshot.files || [])
      .filter((entry) => !query || entry.path.toLowerCase().includes(query))
      .slice(0, limit);
    return {
      text: `Found ${files.length} VS Code workspace entr${files.length === 1 ? "y" : "ies"}.`,
      files
    };
  }

  function readFile(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", found: false };
    }
    const requestedPath = normalizePath(args.path || args.file || args.filePath);
    if (!requestedPath) {
      throw new Error("path is required");
    }
    const contents = session.snapshot.fileContents || {};
    const exact = contents[requestedPath];
    const matchedPath = exact == null
      ? Object.keys(contents).find((path) => path.toLowerCase() === requestedPath.toLowerCase() || path.toLowerCase().endsWith(`/${requestedPath.toLowerCase()}`))
      : requestedPath;
    if (!matchedPath || contents[matchedPath] == null) {
      return {
        text: `VS Code has not provided contents for ${requestedPath}. Ask the extension to include this file or open it in VS Code.`,
        found: false,
        path: requestedPath
      };
    }
    const offset = normalizeInteger(args.offset ?? 0, 0, 0, Number.MAX_SAFE_INTEGER);
    const maxChars = normalizeInteger(args.maxChars ?? 12000, 12000, 100, 40000);
    const content = String(contents[matchedPath] || "");
    return {
      text: content.slice(offset, offset + maxChars),
      found: true,
      path: matchedPath,
      offset,
      nextOffset: offset + maxChars < content.length ? offset + maxChars : null,
      charCount: content.length
    };
  }

  function getDiagnostics(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", diagnostics: [] };
    }
    const pathFilter = normalizePath(args.path || args.file || "").toLowerCase();
    const limit = normalizeInteger(args.limit ?? 100, 100, 1, 500);
    const diagnostics = (session.snapshot.diagnostics || [])
      .filter((entry) => !pathFilter || entry.path.toLowerCase().includes(pathFilter))
      .slice(0, limit);
    return {
      text: diagnostics.length ? `Found ${diagnostics.length} VS Code diagnostic${diagnostics.length === 1 ? "" : "s"}.` : "No matching VS Code diagnostics.",
      diagnostics
    };
  }

  function getGitStatus(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", git: null };
    }
    return {
      text: session.snapshot.git?.statusText || `VS Code git branch: ${session.snapshot.git?.branch || "unknown"}.`,
      git: session.snapshot.git || {}
    };
  }

  async function requestEdit(args = {}) {
    const session = pickSession(args.sessionId);
    if (!session) {
      return { text: "No VS Code session is connected.", queued: false };
    }
    const path = normalizePath(args.path || args.file || args.filePath);
    if (!path) {
      throw new Error("path is required");
    }
    const request = {
      id: `edit-${nowMs()}-${crypto.randomBytes(4).toString("hex")}`,
      type: "edit",
      sessionId: session.sessionId,
      path,
      title: compactText(args.title || `Nova edit request for ${path}`, 180),
      oldText: Object.prototype.hasOwnProperty.call(args, "oldText") ? String(args.oldText ?? "") : undefined,
      newText: Object.prototype.hasOwnProperty.call(args, "newText") ? String(args.newText ?? "") : undefined,
      content: Object.prototype.hasOwnProperty.call(args, "content") ? String(args.content ?? "") : undefined,
      instructions: compactText(args.instructions || "", 2000),
      status: "pending",
      createdAt: nowMs()
    };
    if (coreTransactions && typeof coreTransactions.proposeExternalEditTransaction === "function") {
      const transaction = await coreTransactions.proposeExternalEditTransaction({
        adapter: "vscode",
        pluginId: "vscode",
        requestId: request.id,
        sessionId: session.sessionId,
        path,
        title: request.title,
        oldText: request.oldText,
        newText: request.newText,
        content: request.content,
        instructions: request.instructions
      }, {
        taskContext: args.taskContext && typeof args.taskContext === "object" ? args.taskContext : {},
        toolCallId: String(args.toolCallId || "").trim()
      });
      request.transactionId = String(transaction?.id || "").trim();
    }
    const state = await loadRequestState();
    state.requests.push(request);
    await saveRequestState(state);
    session.pendingRequests.push(request);
    sessions.set(session.sessionId, session);
    return {
      text: `Queued VS Code edit request ${request.id} for ${path}.`,
      queued: true,
      request
    };
  }

  async function listPendingRequests(args = {}, token = "") {
    await requireToken(token);
    const session = pickSession(args.sessionId);
    const sessionId = String(args.sessionId || session?.sessionId || "").trim();
    const durablePending = await listDurableRequests({ sessionId, status: "pending" });
    if (session) {
      const durableIds = new Set(durablePending.map((r) => r.id));
      const inMemoryOnly = session.pendingRequests
        .filter((r) => r.status === "pending" && !durableIds.has(r.id));
      session.pendingRequests = [...durablePending, ...inMemoryOnly];
      sessions.set(session.sessionId, session);
    }
    const merged = session ? session.pendingRequests : durablePending;
    return {
      requests: merged
    };
  }

  async function completeRequest(requestId = "", payload = {}, token = "") {
    await requireToken(token);
    const state = await loadRequestState();
    const durableRequest = state.requests.find((entry) => entry.id === requestId);
    if (durableRequest) {
      durableRequest.status = payload.ok === false ? "failed" : "completed";
      durableRequest.completedAt = nowMs();
      durableRequest.result = payload && typeof payload === "object" ? payload : {};
      durableRequest.finalDiff = compactText(payload.finalDiff || payload.diff || "", 12000);
      durableRequest.userModified = payload.userModified === true;
      durableRequest.failureReason = payload.ok === false ? compactText(payload.error || payload.message || "", 1000) : "";
      if (durableRequest.transactionId && coreTransactions && typeof coreTransactions.completeExternalTransaction === "function") {
        durableRequest.transaction = await coreTransactions.completeExternalTransaction(durableRequest.transactionId, {
          ...payload,
          finalDiff: durableRequest.finalDiff,
          userModified: durableRequest.userModified,
          failureClass: payload.ok === false ? "vscode_apply_failed" : "",
          actor: "user"
        }).catch((error) => ({
          error: true,
          message: String(error?.message || error || "")
        }));
      }
      await saveRequestState(state);
      for (const session of sessions.values()) {
        const request = session.pendingRequests.find((entry) => entry.id === requestId);
        if (request) {
          Object.assign(request, durableRequest);
          sessions.set(session.sessionId, session);
          break;
        }
      }
      return { request: durableRequest };
    }
    for (const session of sessions.values()) {
      const request = session.pendingRequests.find((entry) => entry.id === requestId);
      if (!request) {
        continue;
      }
      request.status = payload.ok === false ? "failed" : "completed";
      request.completedAt = nowMs();
      request.result = payload && typeof payload === "object" ? payload : {};
      request.finalDiff = compactText(payload.finalDiff || payload.diff || "", 12000);
      request.userModified = payload.userModified === true;
      request.failureReason = payload.ok === false ? compactText(payload.error || payload.message || "", 1000) : "";
      if (request.transactionId && coreTransactions && typeof coreTransactions.completeExternalTransaction === "function") {
        request.transaction = await coreTransactions.completeExternalTransaction(request.transactionId, {
          ...payload,
          finalDiff: request.finalDiff,
          userModified: request.userModified,
          failureClass: payload.ok === false ? "vscode_apply_failed" : "",
          actor: "user"
        }).catch((error) => ({
          error: true,
          message: String(error?.message || error || "")
        }));
      }
      sessions.set(session.sessionId, session);
      return { request };
    }
    const error = new Error("request not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    ensureSettings,
    getBearerToken,
    getPairingInfo,
    getStatus,
    upsertSnapshot,
    getContext,
    listFiles,
    readFile,
    getDiagnostics,
    getGitStatus,
    requestEdit,
    listPendingRequests,
    completeRequest
  };
}
