import { escapeHtml } from "/plugin-tab-shared.js";

let presenceRoot = null;
let presenceState = {
  settings: {},
  observations: [],
  threads: [],
  people: [],
  lastError: ""
};

function formatDateTime(value = 0) {
  const ts = Number(value || 0);
  return ts ? new Date(ts).toLocaleString() : "Unknown time";
}

function ensurePresenceStyles() {
  if (document.getElementById("presencePluginStyles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "presencePluginStyles";
  style.textContent = `
    .presence-stack,
    .presence-thread-list,
    .presence-observation-list,
    .presence-people-list,
    .presence-settings {
      display: grid;
      gap: 10px;
    }
    .presence-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
      gap: 12px;
      align-items: start;
    }
    .presence-observation,
    .presence-thread,
    .presence-person {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 7px;
    }
    .presence-thread {
      border-left: 3px solid rgba(94, 234, 212, 0.72);
    }
    .presence-kind-row,
    .presence-note-list,
    .presence-setting-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .presence-note-list {
      align-items: flex-start;
    }
    .presence-setting-row {
      justify-content: space-between;
    }
    .presence-setting-row input[type="number"] {
      width: 90px;
    }
    @media (max-width: 900px) {
      .presence-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

async function loadPresenceStatus() {
  try {
    const r = await fetch("/api/presence/status");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "presence status unavailable");
    }
    presenceState = {
      settings: j.settings || {},
      observations: Array.isArray(j.observations) ? j.observations : [],
      threads: Array.isArray(j.threads) ? j.threads : [],
      people: Array.isArray(j.people) ? j.people : [],
      lastError: ""
    };
    renderPresence();
  } catch (error) {
    presenceState.lastError = String(error?.message || error || "presence status unavailable");
    renderPresence();
  }
}

async function savePresenceSettings(patch = {}) {
  const r = await fetch("/api/presence/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...presenceState.settings, ...patch })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "failed to save settings");
  }
  presenceState.settings = j.settings || presenceState.settings;
  renderPresence();
}

async function sendPresenceObservation(detail = {}) {
  const text = String(detail?.text || "").trim();
  if (!text || detail?.isFinal === false || detail?.wakeActive === true) {
    return;
  }
  try {
    const r = await fetch("/api/presence/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        isFinal: detail.isFinal !== false,
        mode: detail.mode || "passive",
        source: "voice",
        sourceIdentity: detail.sourceIdentity || null,
        observedAt: Number(detail.at || 0) || Date.now(),
        audioAvailable: true,
        videoAvailable: false
      })
    });
    const j = await r.json();
    if (r.ok && j.ok && j.accepted && j.observation) {
      presenceState.observations = [j.observation, ...presenceState.observations]
        .filter((entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index)
        .slice(0, 80);
      if (j.thread) {
        presenceState.threads = [j.thread, ...presenceState.threads]
          .filter((entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index)
          .slice(0, 30);
      }
      renderPresence();
    }
  } catch {
    // Passive presence should never make voice capture feel broken.
  }
}

function renderNoteGroup(label = "", values = []) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) {
    return "";
  }
  return `
    <div class="presence-note-list">
      <span class="micro"><strong>${escapeHtml(label)}</strong></span>
      ${items.map((item) => `<span class="summary-pill">${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderThread(entry = {}) {
  const notes = entry.notes && typeof entry.notes === "object" ? entry.notes : {};
  const source = entry.sourceIdentity && typeof entry.sourceIdentity === "object" ? entry.sourceIdentity : {};
  const count = Number(entry.observationCount || entry.observations?.length || 0);
  return `
    <article class="presence-thread">
      <div class="presence-kind-row">
        <span class="summary-pill">${escapeHtml(`${count} fragment${count === 1 ? "" : "s"}`)}</span>
        ${entry.question ? `<span class="status-chip">question candidate</span>` : ""}
        <span class="micro">${escapeHtml(formatDateTime(entry.lastObservedAt))}</span>
      </div>
      <div class="history-body">${escapeHtml(entry.summary || "")}</div>
      ${entry.question ? `<div class="micro"><strong>Question:</strong> ${escapeHtml(entry.question)}</div>` : ""}
      ${renderNoteGroup("Mentions", notes.mentions)}
      ${renderNoteGroup("Events", notes.events)}
      ${renderNoteGroup("Tasks", notes.tasks)}
      ${renderNoteGroup("Claims", notes.claims)}
      <div class="micro">${escapeHtml([source.label || "Unknown speaker", source.trustLevel || "unknown", entry.mode || "passive"].filter(Boolean).join(" | "))}</div>
    </article>
  `;
}

function renderObservation(entry = {}) {
  const kinds = Array.isArray(entry.kinds) ? entry.kinds : [];
  const actions = Array.isArray(entry.suggestedActions) ? entry.suggestedActions : [];
  const effects = entry.effects && typeof entry.effects === "object" ? entry.effects : {};
  const source = entry.sourceIdentity && typeof entry.sourceIdentity === "object" ? entry.sourceIdentity : {};
  return `
    <article class="presence-observation">
      <div class="presence-kind-row">
        ${kinds.map((kind) => `<span class="summary-pill">${escapeHtml(String(kind).replaceAll("_", " "))}</span>`).join("")}
        <span class="micro">${escapeHtml(formatDateTime(entry.observedAt))}</span>
      </div>
      <div class="history-body">${escapeHtml(entry.text || "")}</div>
      <div class="micro">${escapeHtml([source.label || "Unknown speaker", source.trustLevel || "unknown", entry.mode || "passive"].filter(Boolean).join(" | "))}</div>
      ${actions.length ? `
        <div class="presence-kind-row">
          ${actions.map((action) => `<span class="status-chip">${escapeHtml(action.type || action.title || "action")}</span>`).join("")}
        </div>
      ` : ""}
      ${effects.todoId || effects.queuedTaskId || effects.personKey ? `
        <div class="micro">${escapeHtml([
          effects.todoId ? `Todo: ${effects.todoId}` : "",
          effects.queuedTaskId ? `Queued answer: ${effects.queuedTaskId}` : "",
          effects.personKey ? `Person: ${effects.personKey}` : ""
        ].filter(Boolean).join(" | "))}</div>
      ` : ""}
      ${entry.thread?.summary ? `<div class="micro"><strong>Thread:</strong> ${escapeHtml(entry.thread.summary)}</div>` : ""}
    </article>
  `;
}

function renderPresence() {
  if (!(presenceRoot instanceof HTMLElement)) {
    return;
  }
  const settings = presenceState.settings || {};
  const observations = presenceState.observations || [];
  const threads = presenceState.threads || [];
  const people = presenceState.people || [];
  presenceRoot.innerHTML = `
    <section class="brain-editor-card presence-stack">
      <div class="panel-head compact">
        <div>
          <h3>Presence</h3>
          <div class="panel-subtle">${presenceState.lastError ? escapeHtml(presenceState.lastError) : `${threads.length} context thread${threads.length === 1 ? "" : "s"}, ${observations.length} raw observation${observations.length === 1 ? "" : "s"}.`}</div>
        </div>
        <button type="button" class="secondary" data-presence-refresh>Refresh</button>
      </div>
      <div class="presence-settings">
        <label class="toggle presence-setting-row">
          <span><strong>Observe passive voice</strong><div class="micro">Uses browser speech transcripts while voice is enabled.</div></span>
          <input type="checkbox" data-presence-setting="enabled" ${settings.enabled !== false ? "checked" : ""} />
        </label>
        <label class="toggle presence-setting-row">
          <span><strong>Queue heard questions</strong><div class="micro">Creates a worker task to answer likely questions.</div></span>
          <input type="checkbox" data-presence-setting="autoQueueQuestions" ${settings.autoQueueQuestions !== false ? "checked" : ""} />
        </label>
        <label class="toggle presence-setting-row">
          <span><strong>Auto-create todos</strong><div class="micro">Adds clear request-like utterances to the todo system.</div></span>
          <input type="checkbox" data-presence-setting="autoCreateTodos" ${settings.autoCreateTodos === true ? "checked" : ""} />
        </label>
        <label class="presence-setting-row">
          <span><strong>Minimum words/noise gate</strong><div class="micro">Shorter transcripts are ignored.</div></span>
          <input type="number" min="1" max="80" step="1" data-presence-number="minimumTextLength" value="${escapeHtml(String(settings.minimumTextLength || 8))}" />
        </label>
      </div>
    </section>
    <section class="brain-editor-card presence-stack">
      <div class="panel-head compact">
        <h3>Context Threads</h3>
        <span class="summary-pill">${escapeHtml(String(threads.length))}</span>
      </div>
      <div class="presence-thread-list">
        ${threads.length ? threads.map(renderThread).join("") : `<div class="panel-subtle">Condensed passive context will appear here.</div>`}
      </div>
    </section>
    <div class="presence-grid">
      <section class="brain-editor-card presence-stack">
        <div class="panel-head compact">
          <h3>Observations</h3>
          <span class="summary-pill">${escapeHtml(String(observations.length))}</span>
        </div>
        <div class="presence-observation-list">
          ${observations.length ? observations.map(renderObservation).join("") : `<div class="panel-subtle">Nothing useful heard yet.</div>`}
        </div>
      </section>
      <section class="brain-editor-card presence-stack">
        <div class="panel-head compact">
          <h3>People</h3>
          <span class="summary-pill">${escapeHtml(String(people.length))}</span>
        </div>
        <div class="presence-people-list">
          ${people.length ? people.map((person) => `
            <div class="presence-person">
              <strong>${escapeHtml(person.label || "Unknown speaker")}</strong>
              <div class="micro">${escapeHtml([person.trustLevel || "unknown", `${Number(person.sampleCount || 0)} sample${Number(person.sampleCount || 0) === 1 ? "" : "s"}`].join(" | "))}</div>
              <div class="micro">Last heard: ${escapeHtml(formatDateTime(person.lastHeardAt))}</div>
            </div>
          `).join("") : `<div class="panel-subtle">Untrusted speaker records will appear here.</div>`}
        </div>
      </section>
    </div>
  `;
  presenceRoot.querySelector("[data-presence-refresh]")?.addEventListener("click", loadPresenceStatus);
  presenceRoot.querySelectorAll("[data-presence-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      savePresenceSettings({ [input.dataset.presenceSetting]: input.checked }).catch((error) => {
        presenceState.lastError = String(error?.message || error || "failed to save setting");
        renderPresence();
      });
    });
  });
  presenceRoot.querySelectorAll("[data-presence-number]").forEach((input) => {
    input.addEventListener("change", () => {
      savePresenceSettings({ [input.dataset.presenceNumber]: Number(input.value || 0) }).catch((error) => {
        presenceState.lastError = String(error?.message || error || "failed to save setting");
        renderPresence();
      });
    });
  });
}

function startPresenceListeners() {
  if (window.__presencePluginListenersStarted) {
    return;
  }
  window.__presencePluginListenersStarted = true;
  window.addEventListener("observer:voice-transcript", (event) => {
    sendPresenceObservation(event?.detail || {});
  });
  window.addEventListener("observer:event", (event) => {
    const data = event?.detail || {};
    if (data.type === "presence.observed" && data.observation) {
      presenceState.observations = [data.observation, ...presenceState.observations]
        .filter((entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index)
        .slice(0, 80);
      if (data.observation.thread) {
        presenceState.threads = [data.observation.thread, ...presenceState.threads]
          .filter((entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index)
          .slice(0, 30);
      }
      renderPresence();
    }
  });
}

export async function mountPluginTab({ root }) {
  presenceRoot = root;
  ensurePresenceStyles();
  startPresenceListeners();
  renderPresence();
  await loadPresenceStatus();
}

export async function refreshPluginTab() {
  await loadPresenceStatus();
}
