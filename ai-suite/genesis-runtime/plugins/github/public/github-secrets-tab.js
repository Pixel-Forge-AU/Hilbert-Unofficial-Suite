import { escapeHtml as h } from "/plugin-tab-shared.js";

let githubSecretsRoot = null;
let pluginAdminFetchRef = null;

function getElements(root = githubSecretsRoot) {
  if (!(root instanceof HTMLElement)) return {};
  return {
    statusEl: root.querySelector("#githubSecretsStatus"),
    detectedUserEl: root.querySelector("#githubDetectedUser"),
    usernameInput: root.querySelector("#githubUsernameInput"),
    patInput: root.querySelector("#githubPatInput"),
    watchedReposInput: root.querySelector("#githubWatchedReposInput"),
    pollIntervalInput: root.querySelector("#githubPollIntervalInput"),
    saveBtn: root.querySelector("#githubSaveBtn"),
    clearPatBtn: root.querySelector("#githubClearPatBtn")
  };
}

function ensureMarkup(root = githubSecretsRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.githubSecretsMounted === "1") return;
  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>GitHub Configuration</h3>
          <div class="panel-subtle">Connect Nova to your GitHub account to receive and act on notifications.</div>
        </div>
      </div>
      <div id="githubSecretsStatus" class="panel-subtle">Loading...</div>
      <div class="stack-list">
        <div class="brain-editor-row">
          <label class="brain-editor-label">Detected Account</label>
          <span id="githubDetectedUser" class="panel-subtle">Checking gh auth...</span>
        </div>
        <div class="brain-editor-row">
          <label class="brain-editor-label" for="githubUsernameInput">Username Override</label>
          <input id="githubUsernameInput" type="text" class="brain-editor-input"
            placeholder="Leave blank to use detected gh auth user" autocomplete="off" />
          <div class="panel-subtle">Override which GitHub user Nova operates on behalf of.</div>
        </div>
        <div class="brain-editor-row">
          <label class="brain-editor-label" for="githubPatInput">Personal Access Token</label>
          <input id="githubPatInput" type="password" class="brain-editor-input"
            placeholder="ghp_... (optional — leave blank to use gh auth)" autocomplete="off" />
          <div class="panel-subtle">Optional. If set, Nova uses this token instead of the local gh CLI auth.
            Needs <code>notifications</code> and <code>repo</code> scopes.</div>
        </div>
        <div class="brain-editor-row">
          <label class="brain-editor-label" for="githubWatchedReposInput">Watched Repos</label>
          <input id="githubWatchedReposInput" type="text" class="brain-editor-input"
            placeholder="e.g. my-org, my-org/specific-repo (comma separated)" autocomplete="off" />
          <div class="panel-subtle">Optional. Filter notifications to repos matching these patterns.
            Leave blank to watch all repos.</div>
        </div>
        <div class="brain-editor-row">
          <label class="brain-editor-label" for="githubPollIntervalInput">Poll Interval (minutes)</label>
          <input id="githubPollIntervalInput" type="number" class="brain-editor-input"
            min="1" max="60" style="max-width:80px" />
        </div>
        <div class="brain-editor-row" style="gap:8px;display:flex">
          <button id="githubSaveBtn" class="brain-editor-btn brain-editor-btn-primary">Save</button>
          <button id="githubClearPatBtn" class="brain-editor-btn">Clear PAT</button>
        </div>
      </div>
    </div>
  `;
  root.dataset.githubSecretsMounted = "1";
}

async function adminFetch(url = "", options = {}) {
  if (typeof pluginAdminFetchRef === "function") {
    return pluginAdminFetchRef(url, options);
  }
  return fetch(url, options);
}

async function loadStatus() {
  const { statusEl, detectedUserEl, usernameInput, watchedReposInput, pollIntervalInput } = getElements();
  if (!statusEl) return;
  statusEl.textContent = "Loading...";
  try {
    const [statusRes, configRes] = await Promise.all([
      adminFetch("/api/github/status"),
      adminFetch("/api/github/config")
    ]);
    const status = await statusRes.json();
    const configPayload = await configRes.json();
    const config = configPayload.config || {};

    if (detectedUserEl) {
      detectedUserEl.textContent = status.detectedUsername
        ? `@${status.detectedUsername} (via gh auth)`
        : status.authOk === false ? "gh CLI not authenticated" : "not detected";
    }
    if (usernameInput) usernameInput.value = config.username || "";
    if (watchedReposInput) watchedReposInput.value = (config.watchedRepos || []).join(", ");
    if (pollIntervalInput) pollIntervalInput.value = String(config.pollIntervalMinutes || 5);

    const parts = [];
    if (status.lastPollAt) {
      const ago = Math.round((Date.now() - status.lastPollAt) / 1000);
      parts.push(`Last polled ${ago}s ago`);
    }
    if (status.lastUnreadCount != null) {
      parts.push(`${status.lastUnreadCount} unread notification${status.lastUnreadCount === 1 ? "" : "s"}`);
    }
    if (config.pat) parts.push("PAT configured");
    statusEl.textContent = parts.length ? parts.join(" · ") : "Ready";
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error loading status: ${err.message}`;
  }
}

async function saveConfig() {
  const { statusEl, usernameInput, patInput, watchedReposInput, pollIntervalInput, saveBtn } = getElements();
  if (saveBtn) saveBtn.disabled = true;
  if (statusEl) statusEl.textContent = "Saving...";
  try {
    const watchedRaw = String(watchedReposInput?.value || "").trim();
    const watchedRepos = watchedRaw ? watchedRaw.split(",").map((r) => r.trim()).filter(Boolean) : [];
    const pollIntervalMinutes = Number(pollIntervalInput?.value || 5);
    const body = {
      username: String(usernameInput?.value || "").trim(),
      watchedRepos,
      pollIntervalMinutes: Number.isFinite(pollIntervalMinutes) && pollIntervalMinutes > 0 ? pollIntervalMinutes : 5
    };
    const patValue = String(patInput?.value || "").trim();
    if (patValue) body.pat = patValue;

    const res = await adminFetch("/api/github/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (!res.ok || payload.ok === false) throw new Error(payload.error || "save failed");
    if (patInput) patInput.value = "";
    if (statusEl) statusEl.textContent = "Saved.";
    await loadStatus();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function clearPat() {
  const { statusEl, clearPatBtn } = getElements();
  if (clearPatBtn) clearPatBtn.disabled = true;
  if (statusEl) statusEl.textContent = "Clearing PAT...";
  try {
    const res = await adminFetch("/api/github/config/clear-pat", { method: "POST" });
    const payload = await res.json();
    if (!res.ok || payload.ok === false) throw new Error(payload.error || "clear failed");
    if (statusEl) statusEl.textContent = "PAT cleared.";
    await loadStatus();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
  } finally {
    if (clearPatBtn) clearPatBtn.disabled = false;
  }
}

function bindEvents(root = githubSecretsRoot) {
  const { saveBtn, clearPatBtn } = getElements(root);
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.addEventListener("click", saveConfig);
    saveBtn.dataset.bound = "1";
  }
  if (clearPatBtn && !clearPatBtn.dataset.bound) {
    clearPatBtn.addEventListener("click", clearPat);
    clearPatBtn.dataset.bound = "1";
  }
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;
  githubSecretsRoot = root;
  pluginAdminFetchRef = context?.pluginAdminFetch || null;
  ensureMarkup(root);
  bindEvents(root);
  await loadStatus();
}
