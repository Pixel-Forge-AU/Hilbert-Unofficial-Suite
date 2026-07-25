import argparse
import html
import json
import re
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
from pathlib import Path

from ai_manager import ROOT, load_config, start_llama
from comfy_studio import (
    COMFY_OUTPUT,
    build_workflow_prompt_from_path,
    comfy_error_message,
    ensure_comfy,
    progress as comfy_progress,
    queue_prompt,
)


USERS = ("Derek", "Hippy")
SYSTEM_PROMPT = (
    "You are Hilbert, a concise and helpful local assistant. You are running from a private LAN server. "
    "When web search results are provided, use them as current context and cite the included URLs. "
    "When a local image generation result is provided, summarize what was queued or produced."
)
SAFE_NAME = re.compile(r"[^a-zA-Z0-9_.-]+")
SEARCH_RESULT_LIMIT = 6
IMAGE_WORKFLOW_ID = "core.text-to-image"
IMAGE_WORKFLOW_PATH = ROOT / "packs/core-generation/text-to-image/workflow.json"
IMAGE_WAIT_SECONDS = 900


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hilbert Chat</title>
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
      font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .app {
      display: grid;
      grid-template-columns: 270px 1fr;
      min-height: 100%;
    }
    aside {
      display: grid;
      grid-template-rows: auto auto 1fr;
      min-height: 100vh;
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
      display: grid;
      grid-template-rows: 1fr auto;
      min-width: 0;
      min-height: 100vh;
    }
    main {
      overflow-y: auto;
      padding: 18px;
    }
    .messages {
      width: min(980px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 12px;
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
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      width: min(980px, calc(100% - 36px));
      margin: 0 auto 16px;
      padding: 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 48px 16px;
    }
    @media (max-width: 820px) {
      .app { grid-template-columns: 1fr; }
      aside { min-height: auto; }
      .sessions { max-height: 190px; }
      .chat { min-height: 60vh; }
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
        <h1>Hilbert Chat</h1>
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
         <label>
           User
           <select id="user">
             <option>Derek</option>
             <option>Hippy</option>
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
        <textarea id="prompt" placeholder="Ask Hilbert..." autocomplete="off" autofocus></textarea>
        <button id="send" type="submit">Send</button>
      </form>
    </section>
  </div>
  <script>
    const userEl = document.getElementById("user");
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

    let currentUser = localStorage.getItem("hilbert-user") || "Derek";
    let currentSession = localStorage.getItem("hilbert-session-" + currentUser) || "";
    let sessions = [];
    let currentModel = localStorage.getItem("hilbert-model") || "qwen3-coder-next";

    userEl.value = currentUser;
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
      currentUser = userEl.value;
      localStorage.setItem("hilbert-user", currentUser);
      const data = await api("/api/sessions?user=" + encodeURIComponent(currentUser));
      sessions = data.sessions;
      if (!currentSession || !sessions.some((session) => session.id === currentSession)) {
        currentSession = sessions[0]?.id || "";
      }
      localStorage.setItem("hilbert-session-" + currentUser, currentSession);
      renderSessions();
      if (currentSession) await loadSession(currentSession);
      else renderMessages([]);
    }

    async function loadSession(id) {
      const data = await api(`/api/session?user=${encodeURIComponent(currentUser)}&id=${encodeURIComponent(id)}`);
      currentSession = data.session.id;
      localStorage.setItem("hilbert-session-" + currentUser, currentSession);
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
        body: JSON.stringify({ user: currentUser, title })
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
        body: JSON.stringify({ user: currentUser, id: currentSession, title })
      });
      await loadSessions();
    }

    async function deleteSession() {
      if (!currentSession) return;
      await api("/api/session/delete", {
        method: "POST",
        body: JSON.stringify({ user: currentUser, id: currentSession })
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
          body: JSON.stringify({ user: currentUser, session_id: currentSession, model: currentModel, content: text })
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

    userEl.addEventListener("change", async () => {
      currentUser = userEl.value;
      currentSession = localStorage.getItem("hilbert-session-" + currentUser) || "";
      await loadSessions();
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
        for user in USERS:
            self.user_dir(user).mkdir(parents=True, exist_ok=True)

    def user_dir(self, user):
        return self.root / self.safe_user(user)

    def safe_user(self, user):
        if user not in USERS:
            raise ValueError("unknown user")
        return user

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


class DuckDuckGoLiteParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self.current = None
        self.in_link = False
        self.in_snippet = False
        self.link_text = []
        self.snippet_text = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            href = attrs["href"]
            css = attrs.get("class", "")
            if "result-link" in css or "/l/?" in href or "uddg=" in href or href.startswith("http"):
                if self.current and self.current.get("title"):
                    self.add_current()
                self.current = {"url": normalize_duckduckgo_url(href), "title": "", "snippet": ""}
                self.in_link = True
                self.link_text = []
        elif tag in ("td", "span") and self.current and not self.current.get("snippet"):
            css = attrs.get("class", "")
            if "result-snippet" in css or "result-snippet" in attrs.get("id", ""):
                self.in_snippet = True
                self.snippet_text = []

    def handle_endtag(self, tag):
        if tag == "a" and self.in_link:
            title = clean_space(" ".join(self.link_text))
            if self.current and title:
                self.current["title"] = title
            self.in_link = False
        elif tag in ("td", "span") and self.in_snippet:
            if self.current:
                self.current["snippet"] = clean_space(" ".join(self.snippet_text))
            self.in_snippet = False

    def handle_data(self, data):
        if self.in_link:
            self.link_text.append(data)
        elif self.in_snippet:
            self.snippet_text.append(data)

    def close(self):
        super().close()
        if self.current:
            self.add_current()

    def add_current(self):
        item = self.current
        self.current = None
        if not item or not item.get("title") or not item.get("url"):
            return
        if item["url"].startswith(("javascript:", "#")):
            return
        if any(existing["url"] == item["url"] for existing in self.results):
            return
        self.results.append(item)


def clean_space(text):
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def normalize_duckduckgo_url(url):
    url = html.unescape(url)
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if "uddg" in query:
        return query["uddg"][0]
    if url.startswith("//"):
        return "https:" + url
    return url


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
    local_results = playwright_search(query, limit)
    if local_results is not None:
        return local_results

    url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HilbertChat/1.1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8", "replace")
    parser = DuckDuckGoLiteParser()
    parser.feed(raw)
    parser.close()
    return parser.results[:limit]


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


def looks_like_image_request(text):
    lowered = text.lower()
    has_action = re.search(r"\b(generate|create|make|draw|render|paint)\b", lowered)
    has_media = re.search(r"\b(image|picture|photo|art|artwork|illustration|wallpaper)\b", lowered)
    mentions_comfy = "comfy" in lowered or "local image" in lowered
    return bool((has_action and has_media) or mentions_comfy)


def extract_image_prompt(text):
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:please\s+)?(?:use\s+)?(?:local\s+)?(?:comfyui|comfy)\s+(?:to\s+)?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"^(?:please\s+)?(?:generate|create|make|draw|render|paint)(?:\s+me)?(?:\s+an?|\s+the)?\s+(?:image|picture|photo|artwork|art|illustration|wallpaper)?\s*(?:of|showing|with|for|:)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or text.strip()


def media_url(filename, subfolder=""):
    parts = ["/media"]
    if subfolder:
        parts.extend(Path(subfolder).parts)
    parts.append(filename)
    return "/".join(urllib.parse.quote(part) for part in parts)


def absolute_chat_url(handler, path):
    host = handler.headers.get("Host")
    if host:
        return f"http://{host}{path}"
    return path


def generate_image_with_comfy(handler, text, model=None):
    prompt_text = extract_image_prompt(text)
    config = load_config()
    ok, message = ensure_comfy(config)
    if not ok:
        raise RuntimeError(message)

    values = image_control_values(prompt_text)
    prompt, seed, catalog_item = build_workflow_prompt_from_path(IMAGE_WORKFLOW_PATH, values, workflow_id=IMAGE_WORKFLOW_ID)
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

    return format_image_response(handler, prompt_text, prompt_id, seed, catalog_item, latest, message, restart_message)


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


def format_image_response(handler, prompt_text, prompt_id, seed, catalog_item, status, start_message, restart_message=""):
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
            url = media_url(item["filename"], item.get("subfolder", ""))
            lines.append(f"![{item['filename']}]({url})")
            lines.append(f"[Open image]({absolute_chat_url(handler, url)})")
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
            query = urllib.parse.parse_qs(parsed.query)
            user = query.get("user", ["Derek"])[0]
            self.send_json({"users": USERS, "sessions": self.server.store.list_sessions(user)})
            return
        if parsed.path == "/api/models":
            self.send_json({"models": self.get_available_models()})
            return
        if parsed.path == "/api/session":
            query = urllib.parse.parse_qs(parsed.query)
            user = query.get("user", ["Derek"])[0]
            session_id = query.get("id", [""])[0]
            self.send_json({"session": self.server.store.get_session(user, session_id)})
            return
        self.send_error(404)

    def do_POST(self):
        try:
            payload = self.read_json()
            if self.path == "/api/session":
                session = self.server.store.create_session(payload.get("user", "Derek"), payload.get("title", "New Chat"))
                self.send_json({"session": session})
                return
            if self.path == "/api/session/rename":
                session = self.server.store.rename_session(payload.get("user", "Derek"), payload.get("id", ""), payload.get("title", "New Chat"))
                self.send_json({"session": session})
                return
            if self.path == "/api/session/delete":
                self.server.store.delete_session(payload.get("user", "Derek"), payload.get("id", ""))
                self.send_json({"ok": True})
                return
            if self.path == "/api/chat":
                user = payload.get("user", "Derek")
                session_id = payload.get("session_id", "")
                model = payload.get("model", self.server.model)
                content = (payload.get("content") or "").strip()
                if not content:
                    raise ValueError("content is required")
                session = self.server.store.get_session(user, session_id)
                assistant_text = self.respond(session["messages"], content, model)
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

    def llama_url(self, path):
        return f"http://{self.server.llama_host}:{self.server.llama_port}{path}"

    def get_available_models(self):
        """Fetch available models from a local OpenAI-compatible server."""
        for path in ("/models", "/v1/models"):
            try:
                with urllib.request.urlopen(self.llama_url(path), timeout=5) as response:
                    data = json.loads(response.read())
                if isinstance(data, dict) and "data" in data:
                    return [m.get("id", m.get("name", "")) for m in data["data"] if isinstance(m, dict)]
                if isinstance(data, list):
                    return [m.get("id", m.get("name", "")) for m in data if isinstance(m, dict)]
            except Exception:
                continue
        return []

    def check_model(self):
        for path in ("/health", "/api/version", "/v1/models"):
            try:
                with urllib.request.urlopen(self.llama_url(path), timeout=2) as response:
                    return response.status == 200
            except Exception:
                continue
        return False

    def respond(self, history_messages, content, model=None):
        if looks_like_image_request(content):
            return generate_image_with_comfy(self, content, model)

        if looks_like_search_request(content):
            query = extract_search_query(content)
            results = web_search(query)
            search_context = format_search_context(query, results)
            tool_message = {
                "role": "system",
                "content": (
                    "You have web search results for the user's request below. "
                    "Answer using the results where relevant and include source URLs.\n\n"
                    f"{search_context}"
                ),
            }
            messages = history_messages + [tool_message, {"role": "user", "content": content}]
            return self.chat(messages, model)

        messages = history_messages + [{"role": "user", "content": content}]
        return self.chat(messages, model)

    def chat(self, messages, model=None):
        body = json.dumps({
            "model": model or self.server.model,
            "messages": messages,
            "temperature": 0.6,
            "top_p": 0.9,
            "max_tokens": 2048,
        }).encode("utf-8")
        request = urllib.request.Request(
            self.llama_url("/v1/chat/completions"),
            data=body,
            headers={"Content-Type": "application/json", "Authorization": "Bearer sk-local"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"local LLM returned HTTP {exc.code}: {detail}") from exc
        return payload["choices"][0]["message"]["content"]


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
    print(f"Hilbert Chat listening on http://{args.host}:{args.port}", flush=True)
    print(f"Using local LLM at http://{args.llama_host}:{args.llama_port}", flush=True)
    print(f"Saving sessions under {args.data_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
