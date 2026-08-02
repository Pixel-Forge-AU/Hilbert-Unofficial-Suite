import { escapeHtml } from "/plugin-tab-shared.js";

let app = window.ObserverApp || {};
let currentEpisode = null;
let els = {};

function formatDateTime(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) {
      return "";
    }
    return new Date(time).toLocaleString();
}

function setStatus(text = "") {
    if (els.status) {
      els.status.textContent = text;
    }
}

function renderEpisode() {
    if (!els.episode) {
      return;
    }
    if (!currentEpisode) {
      els.episode.innerHTML = `<div class="panel-subtle">No website reading is queued.</div>`;
      return;
    }
    els.episode.innerHTML = `
      <div class="panel-section">
        <div class="section-title">${escapeHtml(currentEpisode.title || "Website reading")}</div>
        <div class="micro">${escapeHtml(currentEpisode.finalUrl || currentEpisode.url || "")}</div>
        <div class="micro">${escapeHtml(formatDateTime(currentEpisode.createdAt))} · ${Number(currentEpisode.scriptChars || 0).toLocaleString()} characters</div>
      </div>
      <textarea class="podcast-reader-script" spellcheck="false">${escapeHtml(currentEpisode.script || "")}</textarea>
    `;
    const scriptBox = els.episode.querySelector(".podcast-reader-script");
    scriptBox?.addEventListener("input", () => {
      currentEpisode = {
        ...currentEpisode,
        script: scriptBox.value,
        scriptChars: scriptBox.value.length
      };
    });
}

function playEpisode() {
    const script = String(currentEpisode?.script || "").trim();
    if (!script) {
      setStatus("Nothing ready to read.");
      return;
    }
    if (typeof app.presentPayloadSpeech === "function") {
      app.presentPayloadSpeech(script, {
        bypassVoiceCaptureBlock: true,
        onStart: () => setStatus("Reading aloud."),
        onComplete: () => setStatus("Finished.")
      });
      return;
    }
    if (!("speechSynthesis" in window)) {
      setStatus("Browser speech synthesis is unavailable.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script.replace(/\[nova:[^\]]+\]/g, " "));
    utterance.lang = "en-AU";
    utterance.rate = 1.08;
    utterance.onstart = () => setStatus("Reading aloud.");
    utterance.onend = () => setStatus("Finished.");
    window.speechSynthesis.speak(utterance);
}

function stopEpisode() {
    if (typeof app.stopPayloadSpeech === "function") {
      app.stopPayloadSpeech();
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setStatus("Stopped.");
}

async function loadState() {
    try {
      const adminFetch = typeof app.adminFetch === "function" ? app.adminFetch.bind(app) : fetch;
      const response = await adminFetch("/api/podcast-reader/state");
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || "state unavailable");
      }
      currentEpisode = data.lastEpisode || null;
      renderEpisode();
    } catch (error) {
      setStatus(`Load failed: ${error.message}`);
    }
}

async function readUrl() {
    const url = String(els.url?.value || "").trim();
    if (!url) {
      setStatus("Enter a URL first.");
      return;
    }
    setStatus("Preparing website reading.");
    try {
      const adminFetch = typeof app.adminFetch === "function" ? app.adminFetch.bind(app) : fetch;
      const response = await adminFetch("/api/podcast-reader/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          maxChars: Number(els.maxChars?.value || 12000) || 12000
        })
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || data.message || "read failed");
      }
      currentEpisode = data.episode;
      renderEpisode();
      playEpisode();
    } catch (error) {
      setStatus(`Read failed: ${error.message}`);
    }
}

function handleEpisodeEvent(event = {}) {
    currentEpisode = event.episode || null;
    renderEpisode();
    playEpisode();
}

export async function mountPluginTab({ root, observerApp, pluginAdminFetch }) {
    app = observerApp || window.ObserverApp || {};
    if (pluginAdminFetch && typeof app.adminFetch !== "function") {
      app = { ...app, adminFetch: pluginAdminFetch };
    }
    root.innerHTML = `
      <style>
        .podcast-reader-shell { display: grid; gap: 12px; }
        .podcast-reader-row { display: grid; grid-template-columns: minmax(0, 1fr) 120px auto auto; gap: 8px; align-items: center; }
        .podcast-reader-row input { min-width: 0; }
        .podcast-reader-script { width: 100%; min-height: 260px; resize: vertical; }
        @media (max-width: 760px) {
          .podcast-reader-row { grid-template-columns: 1fr; }
        }
      </style>
      <div class="podcast-reader-shell">
        <div class="podcast-reader-row">
          <input id="podcastReaderUrl" type="url" placeholder="https://example.com/article" />
          <input id="podcastReaderMax" type="number" min="1500" max="20000" step="500" value="12000" />
          <button id="podcastReaderRead" type="button">Read</button>
          <button id="podcastReaderStop" type="button">Stop</button>
        </div>
        <div class="micro" id="podcastReaderStatus"></div>
        <div id="podcastReaderEpisode"></div>
      </div>
    `;
    els = {
      url: root.querySelector("#podcastReaderUrl"),
      maxChars: root.querySelector("#podcastReaderMax"),
      read: root.querySelector("#podcastReaderRead"),
      stop: root.querySelector("#podcastReaderStop"),
      status: root.querySelector("#podcastReaderStatus"),
      episode: root.querySelector("#podcastReaderEpisode")
    };
    els.read?.addEventListener("click", readUrl);
    els.stop?.addEventListener("click", stopEpisode);
    if (typeof app.registerPluginEventHandler === "function") {
      app.registerPluginEventHandler("podcast-reader", handleEpisodeEvent);
    }
    await loadState();
}

export async function refreshPluginTab() {
  await loadState();
}
