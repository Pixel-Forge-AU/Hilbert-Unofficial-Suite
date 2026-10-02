import argparse
import html
import json
import re
import shutil
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import yaml

import llm_endpoints
from ai_manager import ROOT, load_config, start_llama
from duckduckgo_search import duckduckgo_http_search
from comfy_studio import (
    COMFY_INPUT,
    COMFY_OUTPUT,
    build_workflow_prompt_from_path,
    comfy_error_message,
    ensure_comfy,
    progress as comfy_progress,
    queue_prompt,
)
from identity import GUEST, resolve_identity, slug as safe_identity_slug


SYSTEM_PROMPT = (
    "You are Echo, the assistant behind Ask Echo, a concise and helpful local assistant. "
    "You are running from a private LAN server. If asked your name, you are Echo. "
    "When web search results are provided, use them as current context and cite the included URLs. "
    "When a local image generation result is provided, summarize what was queued or produced."
)
SAFE_NAME = re.compile(r"[^a-zA-Z0-9_.-]+")
SEARCH_RESULT_LIMIT = 6
IMAGE_WORKFLOW_ID = "core.text-to-image"
# Last-known-good location, used only if the manifest scan below can't find the
# pack by id (e.g. packs/ unreadable) - packs get moved between categories during
# reorgs (this one used to be packs/core-generation/text-to-image/), so resolving
# by manifest id rather than a hardcoded folder path is what keeps this from
# breaking again the next time a pack moves.
IMAGE_WORKFLOW_PATH = ROOT / "packs/image-gen/text-to-image/workflow.json"
IMAGE_WAIT_SECONDS = 900
_image_workflow_path_cache = None


def resolve_image_workflow_path():
    global _image_workflow_path_cache
    if _image_workflow_path_cache and _image_workflow_path_cache.exists():
        return _image_workflow_path_cache
    packs_dir = ROOT / "packs"
    if packs_dir.exists():
        for manifest_path in packs_dir.glob("*/*/manifest.yaml"):
            try:
                manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(manifest, dict) and manifest.get("id") == IMAGE_WORKFLOW_ID:
                candidate = manifest_path.parent / "workflow.json"
                if candidate.exists():
                    _image_workflow_path_cache = candidate
                    return candidate
    return IMAGE_WORKFLOW_PATH


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ask Echo</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101114;
      --panel: #181b20;
      --panel-2: #22262d;
      --text: #eef1f5;
      --muted: #aeb7c3;
      --accent: #20b486;
      --accent-2: #4d93ff;
      --border: #303640;
      --danger: #ff6b6b;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      overflow: hidden;
      font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .app {
      display: grid;
      grid-template-columns: 270px 1fr;
      height: 100%;
    }
    aside {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100%;
      min-height: 0;
      background: var(--panel);
      border-right: 1px solid var(--border);
    }
    .brand { padding: 16px; border-bottom: 1px solid var(--border); }
    h1 { margin: 0; font-size: 19px; letter-spacing: 0; }
    .status { margin-top: 4px; color: var(--muted); font-size: 13px; }
    .controls {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-bottom: 1px solid var(--border);
    }
    select, input, textarea {
      width: 100%;
      color: var(--text);
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      font: inherit;
      outline: none;
    }
    select, input { height: 38px; padding: 0 10px; }
    textarea {
      resize: none;
      min-height: 52px;
      max-height: 190px;
      padding: 12px;
    }
    select:focus, input:focus, textarea:focus { border-color: var(--accent-2); }
    button {
      min-height: 38px;
      padding: 0 12px;
      color: #06130f;
      background: var(--accent);
      border: 0;
      border-radius: 6px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: wait; }
    .ghost {
      color: var(--text);
      background: transparent;
      border: 1px solid var(--border);
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .sessions {
      overflow-y: auto;
      min-height: 0;
      padding: 10px;
    }
    .session {
      display: grid;
      gap: 2px;
      width: 100%;
      margin-bottom: 6px;
      padding: 9px 10px;
      color: var(--text);
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
    }
    .session:hover { background: var(--panel-2); }
    .session.active {
      background: #173629;
      border-color: #245a44;
    }
    .session-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }
    .session-meta { color: var(--muted); font-size: 12px; font-weight: 500; }
    .chat {
      /* A single positioning context, not a grid row per element - the
         composer floats over main (absolutely positioned, see form below)
         instead of owning its own fixed-height row, so it reads as
         detached/elevated above the conversation rather than docked as
         another part of the scrollable layout. */
      position: relative;
      min-width: 0;
      height: 100%;
      min-height: 0;
    }
    main {
      position: absolute;
      inset: 0;
      overflow-y: auto;
      /* Extra bottom padding clears the floating composer so the last
         message never sits underneath it. */
      padding: 18px 18px 104px;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .messages {
      width: min(980px, 100%);
      margin: 0 auto;
      /* Pushes the message list to the bottom of `main` when it's shorter
         than the viewport (a fresh/short conversation hugs the composer
         instead of floating at the top of empty space), the same effect as
         `justify-content: flex-end` on `main` itself but without that
         approach's Safari bug, where a flex container with
         justify-content: flex-end silently blocks scrolling up to reveal
         content that has overflowed above the visible area. */
      margin-top: auto;
      display: grid;
      gap: 14px;
    }
    .message {
      max-width: 86%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    .message pre {
      background: #0d0e11;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .message code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.9em;
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 4px;
      border-radius: 3px;
    }
    .message pre code {
      background: transparent;
      padding: 0;
    }
    .message p {
      margin: 0 0 12px 0;
    }
    .message p:last-child {
      margin-bottom: 0;
    }
    .message ul, .message ol {
      margin: 0 0 12px 24px;
    }
    .message blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin: 0 0 12px 0;
      color: var(--muted);
    }
    .message img {
      max-width: 100%;
      height: auto;
      display: block;
      border-radius: 6px;
    }
    .generated-image {
      margin: 8px 0 12px;
    }
    .generated-image-actions {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .generated-image-actions a {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      text-decoration: none;
    }
    .generated-image-actions a:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .user {
      justify-self: end;
      background: #173629;
      border-color: #245a44;
    }
    .assistant {
      justify-self: start;
      background: var(--panel);
    }
    .system {
      justify-self: center;
      color: var(--muted);
      background: transparent;
      border-color: transparent;
      font-size: 14px;
    }
    .error {
      justify-self: start;
      background: #3a1d22;
      border-color: #6f313a;
      color: #ffd6dc;
    }
    form {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 16px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      width: min(980px, calc(100% - 36px));
      margin: 0 auto;
      padding: 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 48px 16px;
    }
    @media (max-width: 820px) {
      /* Below this width aside stacks above .chat in a single column instead
         of sitting beside it, so the fixed-height/internal-scroll layout
         above (built for a persistent side rail) is dropped in favor of
         letting the whole page scroll normally, same as before. */
      body { overflow: visible; }
      .app { grid-template-columns: 1fr; height: auto; }
      aside { height: auto; min-height: auto; }
      .sessions { min-height: 0; max-height: 190px; }
      .chat { height: auto; min-height: 60vh; }
      form { grid-template-columns: 1fr; }
      .message { max-width: 96%; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <div class="app">
    <aside>
      <div class="brand">
        <h1>Ask Echo</h1>
        <div class="status" id="status">Connecting...</div>
      </div>
       <div class="controls">
         <label>
           Model
           <select id="model">
             <option value="qwen3-coder-next">Qwen3 Coder Next</option>
             <option value="qwen3.6-35b-a3b-heretic">Qwen3.6 35B A3B Heretic</option>
             <option value="qwen-small">Qwen3 Coder Next (Small)</option>
           </select>
         </label>
         <input id="sessionName" placeholder="New session name">
        <div class="row">
          <button id="newSession" type="button">New</button>
          <button class="ghost" id="renameSession" type="button">Rename</button>
        </div>
        <button class="ghost" id="deleteSession" type="button">Delete Session</button>
      </div>
      <div class="sessions" id="sessions"></div>
    </aside>
    <section class="chat">
      <main id="scroll">
        <div class="messages" id="messages"></div>
      </main>
      <form id="form">
        <textarea id="prompt" placeholder="Ask Echo..." autocomplete="off" autofocus></textarea>
        <button id="send" type="submit">Send</button>
      </form>
    </section>
  </div>
  <script>
    const modelEl = document.getElementById("model");
    const sessionsEl = document.getElementById("sessions");
    const messagesEl = document.getElementById("messages");
    const promptEl = document.getElementById("prompt");
    const formEl = document.getElementById("form");
    const sendEl = document.getElementById("send");
    const statusEl = document.getElementById("status");
    const scrollEl = document.getElementById("scroll");
    const nameEl = document.getElementById("sessionName");
    const newEl = document.getElementById("newSession");
    const renameEl = document.getElementById("renameSession");
    const deleteEl = document.getElementById("deleteSession");

    let currentSession = localStorage.getItem("hilbert-session") || "";
    let sessions = [];
    let currentModel = localStorage.getItem("hilbert-model") || "";

    modelEl.value = currentModel;

    // Fetch available models from the server
    async function loadModels() {
      try {
        const data = await api("/api/models");
        if (data.models && data.models.length > 0) {
          modelEl.innerHTML = "";
          for (const model of data.models) {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model;
            modelEl.appendChild(option);
          }
          // data.models is priority-ordered (a configured network inference box
          // first, then local fallbacks) - keep the remembered pick only if it's
          // still actually available, otherwise default to the top of that list
          // rather than silently keep asking for a model that may not be online.
          if (!data.models.includes(currentModel)) {
            currentModel = data.models[0];
            localStorage.setItem("hilbert-model", currentModel);
          }
          modelEl.value = currentModel;
        }
      } catch (error) {
        console.log("Could not load models from server:", error);
      }
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function escapeText(value) {
      return value == null ? "" : String(value);
    }

    // Escape HTML special characters for user input (to prevent XSS)
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    function formatTime(epoch) {
      if (!epoch) return "";
      return new Date(epoch * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    // Configure and initialize marked.js
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        sanitize: false
      });
      console.log("marked.js initialized successfully");
    } else {
      console.error("marked.js is not loaded");
    }

    // Simple Markdown parser using marked.js
    function parseMarkdown(text) {
      if (!text) return "";
      try {
        const result = marked.parse(text);
        console.log("Markdown parsed:", text.substring(0, 50), "->", result.substring(0, 50));
        return result;
      } catch (e) {
        console.error("Markdown parse error:", e);
        return text;
      }
    }

    function openInStudio(event) {
      event.preventDefault();
      var url;
      if (window.hearthService && window.hearthService.prefix) {
        // Proxied through a trusted identity service - Studio's
        // own proxied page is Chat's sibling under the same prefix scheme.
        url = window.hearthService.prefix.replace(/\/chat\/?$/, "/studio/") + "#library";
      } else {
        url = window.location.protocol + "//" + window.location.hostname + ":39000/#library";
      }
      window.open(url, "_blank");
    }

    function addMessage(role, text) {
      const item = document.createElement("div");
      item.className = "message " + role;
      // For user messages, escape HTML first to prevent XSS, then parse Markdown
      // For assistant messages, parse Markdown directly (trusted content from AI)
      const content = role === "user" ? escapeHtml(text) : text;
      item.innerHTML = parseMarkdown(content);
      messagesEl.appendChild(item);
      scrollEl.scrollTop = scrollEl.scrollHeight;
      return item;
    }

    function renderSessions() {
      sessionsEl.innerHTML = "";
      if (!sessions.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No sessions yet.";
        sessionsEl.appendChild(empty);
        return;
      }
      for (const session of sessions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "session" + (session.id === currentSession ? " active" : "");
        button.innerHTML = `<span class="session-title"></span><span class="session-meta"></span>`;
        button.querySelector(".session-title").textContent = session.title;
        button.querySelector(".session-meta").textContent = `${session.message_count} messages · ${formatTime(session.updated_at)}`;
        button.addEventListener("click", () => selectSession(session.id));
        sessionsEl.appendChild(button);
      }
    }

    function renderMessages(messages) {
      messagesEl.innerHTML = "";
      const visible = messages.filter((message) => message.role !== "system");
      if (!visible.length) {
        addMessage("system", "New session ready.");
        return;
      }
      for (const message of visible) addMessage(message.role, message.content);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    async function refreshHealth() {
      try {
        const data = await api("/api/health");
        setStatus(data.ok ? "Model online" : "Model unavailable");
      } catch {
        setStatus("Chat server unavailable");
      }
    }

    async function loadSessions() {
      const data = await api("/api/sessions");
      sessions = data.sessions;
      if (!currentSession || !sessions.some((session) => session.id === currentSession)) {
        currentSession = sessions[0]?.id || "";
      }
      localStorage.setItem("hilbert-session", currentSession);
      renderSessions();
      if (currentSession) await loadSession(currentSession);
      else renderMessages([]);
    }

    async function loadSession(id) {
      const data = await api(`/api/session?id=${encodeURIComponent(id)}`);
      currentSession = data.session.id;
      localStorage.setItem("hilbert-session", currentSession);
      nameEl.value = data.session.title;
      renderSessions();
      renderMessages(data.session.messages);
    }

    async function selectSession(id) {
      currentSession = id;
      await loadSession(id);
      promptEl.focus();
    }

    async function createSession() {
      const title = nameEl.value.trim() || "New Chat";
      const data = await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ title })
      });
      currentSession = data.session.id;
      await loadSessions();
      await loadSession(currentSession);
    }

    async function renameSession() {
      if (!currentSession) return;
      const title = nameEl.value.trim();
      if (!title) return;
      await api("/api/session/rename", {
        method: "POST",
        body: JSON.stringify({ id: currentSession, title })
      });
      await loadSessions();
    }

    async function deleteSession() {
      if (!currentSession) return;
      await api("/api/session/delete", {
        method: "POST",
        body: JSON.stringify({ id: currentSession })
      });
      currentSession = "";
      await loadSessions();
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      if (!currentSession) await createSession();
      promptEl.value = "";
      promptEl.style.height = "";
      addMessage("user", text);
      sendEl.disabled = true;
      setStatus("Thinking...");
      const placeholder = addMessage("assistant", "...");
      try {
        const data = await api("/api/chat", {
          method: "POST",
          body: JSON.stringify({ session_id: currentSession, model: currentModel, content: text })
        });
        placeholder.innerHTML = parseMarkdown(data.assistant.content || "");
        await loadSessions();
        setStatus("Model online");
      } catch (error) {
        placeholder.className = "message error";
        placeholder.textContent = error.message;
        setStatus("Error");
      } finally {
        sendEl.disabled = false;
        promptEl.focus();
      }
    });

    promptEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        formEl.requestSubmit();
      }
    });

    promptEl.addEventListener("input", () => {
      promptEl.style.height = "auto";
      promptEl.style.height = Math.min(promptEl.scrollHeight, 190) + "px";
    });

    newEl.addEventListener("click", createSession);
    renameEl.addEventListener("click", renameSession);
    deleteEl.addEventListener("click", deleteSession);

    // Load models on page load
    loadModels();
    refreshHealth();
    loadSessions().catch((error) => {
      setStatus("Error");
      renderMessages([{ role: "system", content: error.message }]);
    });
    setInterval(refreshHealth, 15000);

    // Update model when dropdown changes
    modelEl.addEventListener("change", () => {
      currentModel = modelEl.value;
      localStorage.setItem("hilbert-model", currentModel);
    });
  </script>
</body>
</html>
"""


class ChatStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.user_dir(GUEST)

    def user_dir(self, user):
        path = self.root / self.safe_user(user)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def safe_user(self, user):
        return safe_identity_slug(user)

    def session_path(self, user, session_id):
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", session_id or ""):
            raise ValueError("invalid session id")
        return self.user_dir(user) / f"{session_id}.json"

    def list_sessions(self, user):
        with self.lock:
            sessions = []
            for path in self.user_dir(user).glob("*.json"):
                session = self.read_path(path)
                sessions.append(self.summary(session))
            sessions.sort(key=lambda item: item["updated_at"], reverse=True)
            return sessions

    def get_session(self, user, session_id):
        with self.lock:
            path = self.session_path(user, session_id)
            if not path.exists():
                raise ValueError("session not found")
            return self.read_path(path)

    def create_session(self, user, title):
        now = time.time()
        title = clean_title(title)
        session = {
            "id": uuid.uuid4().hex[:12],
            "user": user,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}],
        }
        with self.lock:
            self.write_session(user, session)
        return session

    def rename_session(self, user, session_id, title):
        with self.lock:
            session = self.get_session_unlocked(user, session_id)
            session["title"] = clean_title(title)
            session["updated_at"] = time.time()
            self.write_session(user, session)
            return session

    def delete_session(self, user, session_id):
        with self.lock:
            path = self.session_path(user, session_id)
            if path.exists():
                path.unlink()

    def append_exchange(self, user, session_id, user_text, assistant_text):
        with self.lock:
            session = self.get_session_unlocked(user, session_id)
            session["messages"].append({"role": "user", "content": user_text})
            session["messages"].append({"role": "assistant", "content": assistant_text})
            if session["title"] == "New Chat":
                session["title"] = clean_title(user_text[:48])
            session["updated_at"] = time.time()
            self.write_session(user, session)
            return session

    def get_session_unlocked(self, user, session_id):
        path = self.session_path(user, session_id)
        if not path.exists():
            raise ValueError("session not found")
        return self.read_path(path)

    def read_path(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def write_session(self, user, session):
        path = self.session_path(user, session["id"])
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def summary(self, session):
        return {
            "id": session["id"],
            "title": session.get("title", "New Chat"),
            "created_at": session.get("created_at", 0),
            "updated_at": session.get("updated_at", 0),
            "message_count": len([m for m in session.get("messages", []) if m.get("role") != "system"]),
        }


def clean_title(title):
    title = (title or "New Chat").strip()
    return title[:80] if title else "New Chat"


def looks_like_search_request(text):
    lowered = text.lower()
    return bool(
        re.search(r"\b(search|look up|lookup|google|web|internet|online|latest|current|today|news)\b", lowered)
        and not looks_like_image_request(text)
    )


def extract_search_query(text):
    cleaned = text.strip()
    patterns = [
        r"^(?:please\s+)?(?:search the (?:web|internet)(?: for)?|search online(?: for)?|look up|lookup|google|search)\s+",
        r"^(?:can you|could you|would you)\s+(?:please\s+)?(?:search the (?:web|internet)(?: for)?|search online(?: for)?|look up|lookup|google|search)\s+",
    ]
    for pattern in patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned or text.strip()


def web_search(query, limit=SEARCH_RESULT_LIMIT):
    # playwright_search() already has its own internal fallback chain (a real
    # browser hitting DuckDuckGo, then Bing RSS, then a plain DuckDuckGo HTTP
    # fetch) and only returns None when that whole call failed outright (e.g.
    # unreachable). But "reachable, returned 200, found nothing" is a real
    # outcome too - treating that as final (the old `is not None` check) meant
    # this function's own separate DuckDuckGo fallback below never got a
    # chance to try when Playwright's search legitimately came back empty.
    local_results = playwright_search(query, limit)
    if local_results:
        return local_results

    return duckduckgo_http_search(query, limit, user_agent="Mozilla/5.0 HilbertChat/1.1")["results"]


def playwright_search(query, limit):
    try:
        config = load_config()
        host = config.get("PLAYWRIGHT_HOST", "127.0.0.1")
        if host in ("0.0.0.0", "::"):
            host = "127.0.0.1"
        url = f"http://{host}:{config.get('PLAYWRIGHT_PORT', '39005')}/api/search"
        body = json.dumps({"query": query, "limit": limit}).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read())
        return payload.get("results") or []
    except Exception:
        return None


def format_search_context(query, results):
    if not results:
        return f"Web search query: {query}\nNo search results were found."
    lines = [f"Web search query: {query}", "Search results:"]
    for index, result in enumerate(results, start=1):
        snippet = result.get("snippet") or "No snippet available."
        lines.append(f"{index}. {result['title']}\nURL: {result['url']}\nSnippet: {snippet}")
    return "\n\n".join(lines)


def build_search_instructions(query, results):
    """Confirmed by direct testing against the live model (Qwen3-VL on the
    configured inference box): a softer "you have search results below, use
    them if relevant" framing let it fall back to its trained "I don't have
    real-time access" refusal even with real results sitting right in the
    context. An assertive framing ("you already searched, don't claim
    otherwise") fixed that - but then, without an explicit instruction not
    to, it started confidently fabricating a specific plausible-sounding
    headline that wasn't actually in the (often just category-page-level)
    search results. Both fixes are needed together. This is the one place
    that wording is written - see build_system_message()."""
    context = format_search_context(query, results)
    return (
        "You already ran a live web search yourself and got the results below. "
        "Do not say you cannot search the web or lack real-time access - you just did. "
        "Only state facts that are actually present in these results (titles, snippets, "
        "URLs) - if the results are just links to news sections/homepages rather than a "
        "specific headline or fact the user asked for, say exactly that and list the "
        "relevant links, instead of inventing a plausible-sounding answer that isn't "
        "actually in the data.\n\n"
        f"{context}"
    )


def build_system_message(search_query=None, search_results=None):
    """The one system message for a chat turn - never two. Confirmed by
    direct testing: appending a *second* system-role message (the search
    instructions) after the identity/persona one let the model slip back
    into its "I can't search" refusal even with the assertive wording above;
    merging everything into a single system message fixed it. So a
    search turn's caller builds this instead of the identity prompt plus a
    separately-appended tool message."""
    content = SYSTEM_PROMPT
    if search_query is not None:
        content += "\n\n" + build_search_instructions(search_query, search_results)
    return {"role": "system", "content": content}


def looks_like_image_request(text):
    lowered = text.lower()
    has_action = re.search(r"\b(generate|create|make|draw|render|paint)\b", lowered)
    has_media = re.search(r"\b(image|picture|photo|art|artwork|illustration|wallpaper)\b", lowered)
    # Anchored to the start, mirroring extract_image_prompt's own comfy-prefix strip
    # below - "comfy"/"comfyui" only means "use local image gen" as a *leading*
    # instruction ("comfy, draw a cat", "use comfyui to make..."). A bare substring
    # check here matched "comfy" inside "ComfyUI" mentioned anywhere in a sentence,
    # so any ordinary question about ComfyUI itself ("is comfyui running?") was
    # silently hijacked into an image generation request instead of being answered.
    mentions_comfy = bool(re.match(r"^(?:please\s+)?(?:use\s+)?(?:local\s+)?comfy(?:ui)?\b", lowered)) or lowered.startswith("local image")
    return bool((has_action and has_media) or mentions_comfy)


def extract_image_prompt(text):
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:please\s+)?(?:use\s+)?(?:local\s+)?(?:comfyui|comfy)\s+(?:to\s+)?", "", cleaned, flags=re.IGNORECASE)
    # "can/could/would you [please] ..." has to be stripped before the plain-action-verb
    # pattern below, since that one is anchored at the very start of the string - without
    # this, a request phrased as a question (very much the natural way to ask) never
    # matches at all, and the *entire* sentence - "can you generate me an image of a
    # flower" framing and all - gets sent to the model as the literal prompt instead of
    # just "a flower".
    action_phrase = r"(?:generate|create|make|draw|render|paint)(?:\s+me)?(?:\s+an?|\s+the)?\s+(?:image|picture|photo|artwork|art|illustration|wallpaper)?\s*(?:of|showing|with|for|:)?\s*"
    patterns = [
        rf"^(?:please\s+)?{action_phrase}",
        rf"^(?:can you|could you|would you)\s+(?:please\s+)?{action_phrase}",
    ]
    for pattern in patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned or text.strip()


def media_url(filename, subfolder=""):
    parts = ["/media"]
    if subfolder:
        parts.extend(Path(subfolder).parts)
    parts.append(filename)
    return "/".join(urllib.parse.quote(part) for part in parts)


def copy_output_to_stored_inputs(filename, subfolder=""):
    """Copy a chat-generated output image into ComfyUI/input/studio_uploads,
    the same directory Studio's own "Save Files" upload writes to - so a
    generated image is immediately usable as a workflow input (img2img,
    etc.) without a manual download-then-reupload round trip. Best-effort:
    a failure here shouldn't stop the chat reply from reporting success."""
    try:
        source = (COMFY_OUTPUT / subfolder / filename) if subfolder else (COMFY_OUTPUT / filename)
        if not source.is_file():
            return None
        target_dir = COMFY_INPUT / "studio_uploads"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / filename
        stem, suffix = target.stem, target.suffix
        counter = 1
        while target.exists():
            target = target_dir / f"{stem}-{counter}{suffix}"
            counter += 1
        shutil.copy2(source, target)
        return f"studio_uploads/{target.name}"
    except Exception:
        return None


def generate_image_with_comfy(text, model=None, user=GUEST):
    prompt_text = extract_image_prompt(text)
    config = load_config()
    ok, message = ensure_comfy(config)
    if not ok:
        raise RuntimeError(message)

    values = image_control_values(prompt_text)
    workflow_path = resolve_image_workflow_path()
    prompt, seed, catalog_item = build_workflow_prompt_from_path(workflow_path, values, workflow_id=IMAGE_WORKFLOW_ID, config=config, user=user)
    prompt_id = queue_prompt(config, prompt, catalog_item["media_type"])

    deadline = time.time() + IMAGE_WAIT_SECONDS
    latest = {"prompt_id": prompt_id, "completed": False, "outputs": []}
    while time.time() < deadline:
        latest = comfy_progress(config, prompt_id)
        if latest.get("completed") or latest.get("outputs"):
            break
        time.sleep(2)

    restart_message = ""
    if latest.get("completed") or latest.get("outputs"):
        restart_message = restart_llama_for_model(config, model)
        for item in latest.get("outputs", []):
            if item.get("type") == "image" and item.get("filename"):
                copy_output_to_stored_inputs(item["filename"], item.get("subfolder", ""))

    return format_image_response(prompt_text, prompt_id, seed, catalog_item, latest, message, restart_message)


def restart_llama_for_model(config, model):
    try:
        start_llama(config, profile_for_model(model))
        return "Restarted the chat model after generation."
    except Exception as exc:
        return f"Image generation finished, but I could not restart the chat model automatically: {exc}"


def profile_for_model(model):
    model = (model or "").lower()
    if "heretic" in model:
        return "heretic"
    if "small" in model:
        return "qwen-small"
    return "qwen"


def image_control_values(prompt_text):
    return {
        "67.text": prompt_text,
        "71.text": "low quality, blurry, distorted, extra limbs, bad anatomy",
        "70.seed": "-1",
        "9.filename_prefix": "",
    }


def format_image_response(prompt_text, prompt_id, seed, catalog_item, status, start_message, restart_message=""):
    lines = [
        "Queued a local ComfyUI image generation job.",
        "",
        f"Prompt: {prompt_text}",
        f"Workflow: {catalog_item['name']}",
        f"Prompt ID: `{prompt_id}`",
    ]
    if seed is not None:
        lines.append(f"Seed: `{seed}`")
    if start_message:
        lines.append(f"ComfyUI: {start_message}")
    if restart_message:
        lines.append(f"Chat model: {restart_message}")

    outputs = [item for item in status.get("outputs", []) if item.get("type") == "image" and item.get("filename")]
    if outputs:
        lines.extend(["", "Output:"])
        for item in outputs[:4]:
            filename = item["filename"]
            url = media_url(filename, item.get("subfolder", ""))
            escaped_name = html.escape(filename)
            escaped_url = html.escape(url)
            lines.append(
                '<div class="generated-image">'
                f'<a href="{escaped_url}" target="_blank"><img src="{escaped_url}" alt="{escaped_name}"></a>'
                '<div class="generated-image-actions">'
                f'<a href="{escaped_url}" download="{escaped_name}">Download</a>'
                '<a href="#" onclick="openInStudio(event)">Use in Studio</a>'
                "</div></div>"
            )
        lines.append("")
        lines.append(
            "Generated images are automatically added to Studio's stored inputs, "
            "ready to reuse in any workflow."
        )
        return "\n".join(lines)

    lines.extend(
        [
            "",
            f"Status: `{status.get('status', 'queued')}`",
            "The job is queued/running. While ComfyUI is running, the LLM may be offline until you switch back.",
        ]
    )
    return "\n".join(lines)


class HilbertHandler(BaseHTTPRequestHandler):
    server_version = "HilbertChat/1.1"

    def do_HEAD(self):
        if self.path == "/" or self.path.startswith("/?"):
            self.send_headers(200, "text/html; charset=utf-8", len(HTML.encode("utf-8")))
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self.send_html(HTML)
            return
        if parsed.path.startswith("/media/"):
            self.serve_media(parsed.path)
            return
        if parsed.path == "/api/health":
            self.send_json({"ok": self.check_model()})
            return
        if parsed.path == "/api/sessions":
            user = resolve_identity(self)['user']
            self.send_json({"users": [], "sessions": self.server.store.list_sessions(user)})
            return
        if parsed.path == "/api/models":
            self.send_json({"models": self.get_available_models()})
            return
        if parsed.path == "/api/session":
            user = resolve_identity(self)['user']
            query = urllib.parse.parse_qs(parsed.query)
            session_id = query.get("id", [""])[0]
            self.send_json({"session": self.server.store.get_session(user, session_id)})
            return
        self.send_error(404)

    def do_POST(self):
        try:
            payload = self.read_json()
            user = resolve_identity(self)['user']
            if self.path == "/api/session":
                session = self.server.store.create_session(user, payload.get("title", "New Chat"))
                self.send_json({"session": session})
                return
            if self.path == "/api/session/rename":
                session = self.server.store.rename_session(user, payload.get("id", ""), payload.get("title", "New Chat"))
                self.send_json({"session": session})
                return
            if self.path == "/api/session/delete":
                self.server.store.delete_session(user, payload.get("id", ""))
                self.send_json({"ok": True})
                return
            if self.path == "/api/chat":
                session_id = payload.get("session_id", "")
                # No default here on purpose: falling back to self.server.model (the
                # --model this process happened to be launched with) would make an
                # explicit request for that exact model, which wins the priority-
                # ordered endpoint selection below even when a higher-priority
                # endpoint (the configured LLM_ENDPOINTS box) is also online - the
                # same "stale default fights the real priority list" bug already
                # fixed for the frontend's own model picker.
                model = payload.get("model")
                content = (payload.get("content") or "").strip()
                if not content:
                    raise ValueError("content is required")
                session = self.server.store.get_session(user, session_id)
                assistant_text = self.respond(session["messages"], content, model, user=user)
                updated = self.server.store.append_exchange(user, session_id, content, assistant_text)
                self.send_json({"assistant": {"role": "assistant", "content": assistant_text}, "session": updated})
                return
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=502)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_headers(self, status, content_type, content_length):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(content_length))
        self.end_headers()

    def send_html(self, text):
        body = text.encode("utf-8")
        self.send_headers(200, "text/html; charset=utf-8", len(body))
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_headers(status, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def serve_media(self, path):
        rel = Path(urllib.parse.unquote(path.removeprefix("/media/")))
        target = (COMFY_OUTPUT / rel).resolve()
        output_root = COMFY_OUTPUT.resolve()
        if output_root not in target.parents and target != output_root:
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return
        content_type = "image/png"
        suffix = target.suffix.lower()
        if suffix in (".jpg", ".jpeg"):
            content_type = "image/jpeg"
        elif suffix == ".webp":
            content_type = "image/webp"
        elif suffix == ".gif":
            content_type = "image/gif"
        data = target.read_bytes()
        self.send_headers(200, content_type, len(data))
        self.wfile.write(data)

    def get_available_models(self):
        """Fetch available models across every configured LLM endpoint - the
        LLM_ENDPOINTS network box (if configured) first, then local
        fallbacks - the same priority order Studio's own chat uses, instead
        of only ever asking the single local host:port this process was
        started with."""
        return llm_endpoints.available_models(load_config())

    def check_model(self):
        return llm_endpoints.select_chat_endpoint(load_config()) is not None

    def respond(self, history_messages, content, model=None, user=GUEST):
        if looks_like_image_request(content):
            return generate_image_with_comfy(content, model, user=user)

        non_system = [m for m in history_messages if m.get("role") != "system"]

        if looks_like_search_request(content):
            query = extract_search_query(content)
            results = web_search(query)
            system_message = build_system_message(search_query=query, search_results=results)
            messages = [system_message] + non_system + [{"role": "user", "content": content}]
            return self.chat(messages, model)

        messages = [build_system_message()] + non_system + [{"role": "user", "content": content}]
        return self.chat(messages, model)

    def chat(self, messages, model=None):
        return llm_endpoints.chat_completion(load_config(), messages, model)


def main():
    parser = argparse.ArgumentParser(description="LAN chat UI for a local OpenAI-compatible server.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=39004)
    parser.add_argument("--llama-host", default="127.0.0.1")
    parser.add_argument("--llama-port", type=int, default=39001)
    parser.add_argument("--model", default="qwen3-coder-next")
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent / "chat-data"))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), HilbertHandler)
    server.llama_host = args.llama_host
    server.llama_port = args.llama_port
    server.model = args.model
    server.store = ChatStore(args.data_dir)
    print(f"Ask Echo listening on http://{args.host}:{args.port}", flush=True)
    print("Chat model: whichever configured endpoint is online, LLM_ENDPOINTS first (see llm_endpoints.py)", flush=True)
    print(f"Saving sessions under {args.data_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
