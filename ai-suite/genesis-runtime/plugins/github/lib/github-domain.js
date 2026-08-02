import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compactText } from "../../../observer-general-utils.js";

const execFileAsync = promisify(execFile);

const CONFIG_KEY = "config";
const STATE_KEY = "state";

const DEFAULT_CONFIG = {
  username: "",
  watchedRepos: [],
  pollIntervalMinutes: 5,
  pat: ""
};

function extractHeader(headers = null, name = "") {
  const target = String(name || "").trim().toLowerCase();
  if (!target || !headers) return "";
  if (typeof headers.get === "function") {
    const value = headers.get(target) || headers.get(name);
    return Array.isArray(value) ? value.join(", ") : String(value || "");
  }
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (String(key || "").trim().toLowerCase() === target) {
        return Array.isArray(value) ? value.join(", ") : String(value || "");
      }
    }
  }
  return "";
}

export function classifyGithubMailNotification(message = {}) {
  const fromAddress = String(message?.fromAddress || "").trim().toLowerCase();
  const subject = String(message?.subject || "").trim();
  const text = String(message?.text || message?.rawText || "").trim();
  const headers = message?.headers || null;
  const triageService = String(message?.triage?.trustedAutomation?.service || "").trim().toLowerCase();
  const listId = extractHeader(headers, "list-id");
  const githubReason = extractHeader(headers, "x-github-reason");
  const githubSender = extractHeader(headers, "x-github-sender");
  const combined = `${fromAddress}\n${subject}\n${text}\n${listId}\n${githubReason}\n${githubSender}`.toLowerCase();
  const isGithubSender = fromAddress.endsWith("@github.com")
    || fromAddress.endsWith("@users.noreply.github.com")
    || /\bgithub\.com\b/i.test(listId)
    || triageService === "github";
  if (!isGithubSender) {
    return { matched: false };
  }
  const hasWorkSignal = /\b(pull request|issue|commit|repository|repo|review requested|checks? (?:failed|passed)|workflow|build|deployment|dependabot|security advisory)\b/.test(combined);
  if (!hasWorkSignal && !githubReason && !githubSender) {
    return { matched: false };
  }
  const repoMatch = subject.match(/\[([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)
    || combined.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  const urlMatch = text.match(/https:\/\/github\.com\/[^\s<>"')]+/i);
  return {
    matched: true,
    repo: repoMatch ? String(repoMatch[1] || "").trim() : "",
    reason: String(githubReason || "").trim(),
    sender: String(githubSender || "").trim(),
    subject,
    url: urlMatch ? String(urlMatch[0] || "").trim() : "",
    preview: compactText(text, 900)
  };
}

function summarizeNotification(n = {}) {
  return {
    id: String(n.id || ""),
    type: String(n.subject?.type || "Unknown"),
    title: String(n.subject?.title || ""),
    repo: String(n.repository?.full_name || ""),
    reason: String(n.reason || ""),
    unread: n.unread === true,
    updatedAt: String(n.updated_at || ""),
    subjectUrl: String(n.subject?.url || ""),
    subjectLatestCommentUrl: String(n.subject?.latest_comment_url || ""),
    url: String(n.url || "")
  };
}

export function createGithubDomain({ data = null } = {}) {
  let cachedConfig = null;

  async function readConfig() {
    if (cachedConfig) return cachedConfig;
    const stored = data ? await data.readJson(CONFIG_KEY, null).catch(() => null) : null;
    cachedConfig = { ...DEFAULT_CONFIG, ...(stored || {}) };
    return cachedConfig;
  }

  async function saveConfig(update = {}) {
    const current = await readConfig();
    const next = { ...current, ...update };
    if (data) await data.writeJson(CONFIG_KEY, next);
    cachedConfig = next;
    return next;
  }

  async function readState() {
    return data ? (await data.readJson(STATE_KEY, {}).catch(() => ({}))) : {};
  }

  async function saveState(state = {}) {
    if (data) await data.writeJson(STATE_KEY, state);
  }

  async function ghRun(args = [], { timeoutMs = 20000, input = undefined } = {}) {
    try {
      const config = await readConfig();
      const env = config.pat ? { ...process.env, GH_TOKEN: config.pat } : process.env;
      const opts = { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs, env, windowsHide: true };
      if (input !== undefined) opts.input = input;
      const { stdout, stderr } = await execFileAsync("gh", args, opts);
      return { ok: true, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
    } catch (err) {
      return {
        ok: false,
        stdout: String(err?.stdout || "").trim(),
        stderr: String(err?.stderr || err?.message || "").trim()
      };
    }
  }

  async function ghApi(apiPath = "", { method = "GET", fields = {}, body = null, timeoutMs = 20000 } = {}) {
    const args = ["api", apiPath];
    if (method !== "GET") args.push("-X", method);
    let input;
    if (body !== null) {
      args.push("--input", "-");
      input = typeof body === "string" ? body : JSON.stringify(body);
    } else {
      for (const [k, v] of Object.entries(fields)) {
        args.push("-f", `${k}=${v}`);
      }
    }
    const r = await ghRun(args, { timeoutMs, input });
    if (!r.ok) return { ok: false, error: r.stderr || "gh api failed", data: null };
    if (!r.stdout) return { ok: true, data: null };
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: true, data: r.stdout };
    }
  }

  async function getAuthStatus() {
    const r = await ghRun(["auth", "status"], { timeoutMs: 8000 });
    // gh auth status writes to stderr
    const text = r.stderr || r.stdout;
    const match = text.match(/Logged in to github\.com account (\S+)/i)
      || text.match(/✓ Logged in to github\.com as (\S+)/i);
    return {
      ok: r.ok || text.includes("Logged in"),
      username: match?.[1] || "",
      raw: text
    };
  }

  async function listNotifications({ all = false, participating = false, repoFilter = "" } = {}) {
    let apiPath = `/notifications?all=${all ? "true" : "false"}`;
    if (participating) apiPath += "&participating=true";
    const r = await ghApi(apiPath);
    if (!r.ok) return { ok: false, error: r.error, notifications: [] };
    const raw = Array.isArray(r.data) ? r.data : [];

    const config = await readConfig();
    const watched = [...(config.watchedRepos || []), ...(repoFilter ? [repoFilter] : [])];

    const notifications = watched.length > 0
      ? raw.filter((n) => {
          const repo = String(n.repository?.full_name || "").toLowerCase();
          return watched.some((w) => repo.includes(String(w || "").toLowerCase()));
        })
      : raw;

    return { ok: true, notifications: notifications.map(summarizeNotification) };
  }

  async function getThread(threadId = "") {
    const normalized = String(threadId || "").trim();
    if (!normalized) return { ok: false, error: "threadId is required" };
    const r = await ghApi(`/notifications/threads/${normalized}`);
    if (!r.ok) return { ok: false, error: r.error };

    const summary = summarizeNotification(r.data || {});
    let subject = null;
    let latestComment = null;

    const subjectUrl = String(r.data?.subject?.url || "").trim();
    const latestCommentUrl = String(r.data?.subject?.latest_comment_url || "").trim();

    const [subjectResult, commentResult] = await Promise.all([
      subjectUrl.startsWith("https://api.github.com")
        ? ghApi(subjectUrl.replace("https://api.github.com", ""))
        : Promise.resolve(null),
      latestCommentUrl.startsWith("https://api.github.com") && latestCommentUrl !== subjectUrl
        ? ghApi(latestCommentUrl.replace("https://api.github.com", ""))
        : Promise.resolve(null)
    ]);

    if (subjectResult?.ok && subjectResult.data && typeof subjectResult.data === "object") {
      const d = subjectResult.data;
      subject = {
        number: d.number,
        state: d.state,
        title: d.title,
        body: String(d.body || "").slice(0, 4000),
        user: d.user?.login,
        url: d.html_url,
        merged: d.merged,
        draft: d.draft,
        labels: Array.isArray(d.labels) ? d.labels.map((l) => l.name) : [],
        reviewState: d.mergeable_state
      };
    }

    if (commentResult?.ok && commentResult.data && typeof commentResult.data === "object") {
      const c = commentResult.data;
      latestComment = {
        id: c.id,
        user: c.user?.login,
        body: String(c.body || "").slice(0, 2000),
        createdAt: c.created_at,
        url: c.html_url
      };
    }

    return { ok: true, thread: summary, subject, latestComment };
  }

  async function markRead(threadId = "") {
    const normalized = String(threadId || "").trim();
    if (!normalized) return { ok: false, error: "threadId is required" };
    const r = await ghApi(`/notifications/threads/${normalized}`, { method: "PATCH" });
    return { ok: r.ok, error: r.error };
  }

  async function markAllRead() {
    const r = await ghApi("/notifications", { method: "PUT" });
    return { ok: r.ok, error: r.error };
  }

  async function getStatus() {
    const [config, state, auth] = await Promise.all([readConfig(), readState(), getAuthStatus()]);
    return {
      configured: !!(auth.username || config.username),
      username: config.username || auth.username || "",
      detectedUsername: auth.username || "",
      watchedRepos: config.watchedRepos || [],
      pollIntervalMinutes: config.pollIntervalMinutes || 5,
      hasPat: !!config.pat,
      lastPollAt: state.lastPollAt || null,
      lastUnreadCount: state.lastUnreadCount ?? null,
      authOk: auth.ok
    };
  }

  function splitRepo(repo = "") {
    const parts = String(repo || "").trim().split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  async function addComment(repo = "", issueNumber = 0, body = "") {
    const r = splitRepo(repo);
    if (!r) return { ok: false, error: "repo must be owner/repo" };
    const num = parseInt(issueNumber, 10);
    if (!num) return { ok: false, error: "issueNumber is required" };
    const bodyText = String(body || "").trim();
    if (!bodyText) return { ok: false, error: "body is required" };
    const result = await ghApi(`/repos/${r.owner}/${r.repo}/issues/${num}/comments`, {
      method: "POST",
      body: { body: bodyText }
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, commentId: result.data?.id, url: result.data?.html_url };
  }

  async function closeIssue(repo = "", issueNumber = 0, stateReason = "") {
    const r = splitRepo(repo);
    if (!r) return { ok: false, error: "repo must be owner/repo" };
    const num = parseInt(issueNumber, 10);
    if (!num) return { ok: false, error: "issueNumber is required" };
    const requestBody = { state: "closed" };
    const reason = String(stateReason || "").trim();
    if (reason === "completed" || reason === "not_planned") requestBody.state_reason = reason;
    const result = await ghApi(`/repos/${r.owner}/${r.repo}/issues/${num}`, {
      method: "PATCH",
      body: requestBody
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, state: result.data?.state, url: result.data?.html_url };
  }

  async function submitPrReview(repo = "", prNumber = 0, event = "COMMENT", body = "") {
    const r = splitRepo(repo);
    if (!r) return { ok: false, error: "repo must be owner/repo" };
    const num = parseInt(prNumber, 10);
    if (!num) return { ok: false, error: "prNumber is required" };
    const validEvents = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
    const normalizedEvent = String(event || "COMMENT").trim().toUpperCase();
    if (!validEvents.includes(normalizedEvent)) {
      return { ok: false, error: `event must be one of: ${validEvents.join(", ")}` };
    }
    const result = await ghApi(`/repos/${r.owner}/${r.repo}/pulls/${num}/reviews`, {
      method: "POST",
      body: { event: normalizedEvent, body: String(body || "").trim() }
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, reviewId: result.data?.id, state: result.data?.state, url: result.data?.html_url };
  }

  async function poll() {
    const state = await readState();
    const r = await listNotifications({ all: false });
    const unreadCount = r.notifications.filter((n) => n.unread).length;
    const newNotifications = state.lastPollAt
      ? r.notifications.filter((n) => new Date(n.updatedAt).getTime() > Number(state.lastPollAt || 0))
      : r.notifications;
    await saveState({ ...state, lastPollAt: Date.now(), lastUnreadCount: unreadCount });
    return {
      ok: r.ok,
      notifications: r.notifications,
      newNotifications,
      unreadCount
    };
  }

  return {
    readConfig,
    saveConfig,
    getAuthStatus,
    listNotifications,
    getThread,
    markRead,
    markAllRead,
    getStatus,
    poll,
    addComment,
    closeIssue,
    submitPrReview
  };
}
