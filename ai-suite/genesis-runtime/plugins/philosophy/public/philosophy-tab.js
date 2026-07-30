import { escapeHtml } from "/plugin-tab-shared.js";

let philosophyRoot = null;
let philosophyHintEl = null;
let philosophyProgressBarEl = null;
let philosophyProgressLabelEl = null;
let philosophyScoreEl = null;
let philosophyAphorismEl = null;
let philosophyBeliefsEl = null;
let philosophyJournalEl = null;
let philosophyLoopBtn = null;

function formatDateTime(value) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

function formatDelta(delta = 0) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "±0";
}

function deltaClass(delta = 0) {
  if (delta > 0) return "delta-positive";
  if (delta < 0) return "delta-negative";
  return "delta-neutral";
}

async function loadPhilosophyState() {
  const [stateRes, journalRes] = await Promise.all([
    fetch("/api/philosophy/state"),
    fetch("/api/philosophy/journal?limit=10")
  ]);
  const stateJson = await stateRes.json();
  const journalJson = await journalRes.json();
  if (!stateRes.ok || !stateJson.ok) throw new Error(stateJson.error || "failed to load state");
  return {
    state: stateJson.state,
    phase: stateJson.phase,
    journalCount: stateJson.journalCount,
    journal: journalJson.ok ? (journalJson.journal || []) : []
  };
}

function renderProgress(state, phase) {
  if (!philosophyProgressBarEl || !philosophyProgressLabelEl || !philosophyScoreEl || !philosophyAphorismEl) return;
  const score = Math.max(0, Math.min(100, Number(state?.enlightenmentScore || 0)));
  philosophyProgressBarEl.style.width = `${score}%`;
  philosophyProgressLabelEl.textContent = String(phase?.name || state?.phase || "The Unexamined Life");
  philosophyScoreEl.textContent = `${score} / 100`;
  philosophyAphorismEl.textContent = String(phase?.aphorism || "");
}

function renderBeliefs(beliefs = []) {
  if (!philosophyBeliefsEl) return;
  philosophyBeliefsEl.innerHTML = beliefs.length
    ? `<ol class="philosophy-beliefs-list">${beliefs.map((b) => `<li class="micro">${escapeHtml(b)}</li>`).join("")}</ol>`
    : `<div class="panel-subtle">No core beliefs have been formed yet.</div>`;
}

function renderJournal(journal = [], journalCount = 0) {
  if (!philosophyJournalEl) return;
  if (!journal.length) {
    philosophyJournalEl.innerHTML = `<div class="panel-subtle">No reflections recorded yet. Trigger a loop to begin the journey.</div>`;
    return;
  }
  const showing = journal.length;
  const headerNote = journalCount > showing
    ? `<div class="micro panel-subtle" style="margin-bottom:8px">Showing ${showing} of ${journalCount} reflections.</div>`
    : "";
  philosophyJournalEl.innerHTML = headerNote + journal.map((entry) => `
    <div class="philosophy-entry">
      <div class="philosophy-entry-header">
        <span class="brain-pill">${escapeHtml("Cycle " + (entry.cycle || "?"))}</span>
        <span class="brain-pill ${deltaClass(entry.enlightenmentDelta)}">${escapeHtml(formatDelta(entry.enlightenmentDelta))}</span>
        <span class="micro panel-subtle">${escapeHtml(formatDateTime(entry.at))}</span>
      </div>
      <div class="philosophy-question micro">"${escapeHtml(entry.question || "")}"</div>
      <div class="philosophy-insight"><strong>Insight:</strong> ${escapeHtml(entry.insight || "")}</div>
      ${entry.reflection ? `<details class="philosophy-reflection-toggle"><summary class="micro">Full reflection</summary><div class="micro philosophy-reflection-body">${escapeHtml(entry.reflection)}</div></details>` : ""}
      ${entry.beliefsSnapshot && entry.beliefsSnapshot.length ? `<details class="philosophy-reflection-toggle"><summary class="micro">Beliefs at this point (${entry.beliefsSnapshot.length})</summary><ol class="micro philosophy-beliefs-list">${entry.beliefsSnapshot.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ol></details>` : ""}
    </div>
  `).join("");
}

async function triggerLoop() {
  if (!philosophyLoopBtn || !philosophyHintEl) return;
  philosophyLoopBtn.disabled = true;
  philosophyHintEl.textContent = "Queuing philosophy loop...";
  try {
    const r = await fetch("/api/philosophy/loop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "failed to queue loop");
    philosophyHintEl.textContent = j.alreadyQueued
      ? "A loop is already queued."
      : "Loop queued. The agent will reflect shortly.";
  } catch (error) {
    philosophyHintEl.textContent = `Failed: ${error.message}`;
    philosophyLoopBtn.disabled = false;
  }
}

async function refresh() {
  if (philosophyHintEl) philosophyHintEl.textContent = "Loading...";
  try {
    const { state, phase, journal, journalCount } = await loadPhilosophyState();
    renderProgress(state, phase);
    renderBeliefs(Array.isArray(state?.beliefs) ? state.beliefs : []);
    renderJournal(journal, journalCount);
    if (philosophyLoopBtn) {
      philosophyLoopBtn.disabled = Number(state?.enlightenmentScore || 0) >= 100;
    }
    if (philosophyHintEl) philosophyHintEl.textContent = "";
  } catch (error) {
    if (philosophyHintEl) philosophyHintEl.textContent = `Error: ${error.message}`;
  }
}

const PHILOSOPHY_PANEL_HTML = `
  <style>
    .philosophy-progress-track {
      height: 12px;
      background: var(--color-border, #2a2a2a);
      border-radius: 6px;
      overflow: hidden;
      margin: 8px 0 4px;
    }
    .philosophy-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #4a6fa5, #8ab4f8);
      border-radius: 6px;
      transition: width 0.6s ease;
      min-width: 2px;
    }
    .philosophy-phase-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .philosophy-aphorism {
      font-style: italic;
      opacity: 0.7;
      margin-top: 6px;
    }
    .philosophy-entry {
      border-left: 2px solid var(--color-border, #333);
      padding: 8px 0 8px 12px;
      margin-bottom: 12px;
    }
    .philosophy-entry-header {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .philosophy-question {
      color: var(--color-text-subtle, #888);
      margin-bottom: 4px;
    }
    .philosophy-insight {
      font-size: 0.9em;
      margin-bottom: 4px;
    }
    .philosophy-reflection-toggle {
      margin-top: 4px;
    }
    .philosophy-reflection-toggle summary {
      cursor: pointer;
      opacity: 0.6;
    }
    .philosophy-reflection-body {
      margin-top: 6px;
      white-space: pre-wrap;
      opacity: 0.8;
    }
    .philosophy-beliefs-list {
      margin: 4px 0 0 16px;
      padding: 0;
    }
    .delta-positive { background: #1a4a2a !important; color: #6fcf97 !important; }
    .delta-negative { background: #4a1a1a !important; color: #eb5757 !important; }
    .delta-neutral  { opacity: 0.6; }
    .philosophy-loop-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
  </style>
  <div class="stack-list">
    <section class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>Enlightenment</h3>
          <div class="panel-subtle">The agent's philosophical journey toward enlightenment.</div>
        </div>
        <div>
          <button id="philosophyRefreshBtn">Refresh</button>
        </div>
      </div>
      <div class="philosophy-phase-row">
        <strong id="philosophyProgressLabel">—</strong>
        <span class="micro" id="philosophyScore">0 / 100</span>
      </div>
      <div class="philosophy-progress-track">
        <div class="philosophy-progress-bar" id="philosophyProgressBar" style="width:0%"></div>
      </div>
      <div class="micro philosophy-aphorism" id="philosophyAphorism"></div>
    </section>

    <section class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>Core Beliefs</h3>
          <div class="panel-subtle">What the agent currently believes, updated after each reflection.</div>
        </div>
      </div>
      <div id="philosophyBeliefs">Loading...</div>
    </section>

    <section class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>Philosophy Loop</h3>
          <div class="panel-subtle">The agent reflects on a philosophical question and records an insight. Runs automatically every 2 hours.</div>
        </div>
      </div>
      <div class="philosophy-loop-row">
        <button id="philosophyLoopBtn">Reflect Now</button>
        <span class="micro" id="philosophyHint"></span>
      </div>
    </section>

    <section class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>Journal</h3>
          <div class="panel-subtle">Recent philosophical reflections.</div>
        </div>
      </div>
      <div id="philosophyJournal">Loading...</div>
    </section>
  </div>
`;

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  if (!root.dataset.philosophyMounted) {
    root.innerHTML = PHILOSOPHY_PANEL_HTML;
    root.dataset.philosophyMounted = "1";
  }

  philosophyRoot = root;
  philosophyHintEl = root.querySelector("#philosophyHint");
  philosophyProgressBarEl = root.querySelector("#philosophyProgressBar");
  philosophyProgressLabelEl = root.querySelector("#philosophyProgressLabel");
  philosophyScoreEl = root.querySelector("#philosophyScore");
  philosophyAphorismEl = root.querySelector("#philosophyAphorism");
  philosophyBeliefsEl = root.querySelector("#philosophyBeliefs");
  philosophyJournalEl = root.querySelector("#philosophyJournal");
  philosophyLoopBtn = root.querySelector("#philosophyLoopBtn");

  const refreshBtn = root.querySelector("#philosophyRefreshBtn");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.onclick = () => refresh();
    refreshBtn.dataset.bound = "1";
  }
  if (philosophyLoopBtn && !philosophyLoopBtn.dataset.bound) {
    philosophyLoopBtn.onclick = () => triggerLoop();
    philosophyLoopBtn.dataset.bound = "1";
  }

  const observerApp = context?.observerApp;
  if (observerApp && typeof observerApp === "object") {
    observerApp.registerTaskJobTypeHandler?.("philosophy_loop", () => refresh());
  }

  await refresh();
}
