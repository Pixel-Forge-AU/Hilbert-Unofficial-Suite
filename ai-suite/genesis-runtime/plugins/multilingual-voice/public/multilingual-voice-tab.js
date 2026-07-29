import { escapeHtml as h } from "/plugin-tab-shared.js";

let multilingualVoiceRoot = null;
let multilingualVoiceFetch = fetch;
let multilingualVoiceState = {
  settings: {},
  setup: {},
  configured: false,
  downloading: false,
  recording: false,
  mediaRecorder: null,
  chunks: [],
  startedAt: 0,
  timer: null,
  lastResult: null,
  lastError: ""
};

function ensureMultilingualVoiceStyles() {
  if (document.getElementById("multilingualVoiceStyles")) return;
  const style = document.createElement("style");
  style.id = "multilingualVoiceStyles";
  style.textContent = `
    .multilingual-voice-stack {
      display: grid;
      gap: 12px;
    }
    .multilingual-voice-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
      gap: 12px;
      align-items: start;
    }
    .multilingual-voice-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .multilingual-voice-field {
      display: grid;
      gap: 5px;
    }
    .multilingual-voice-field input,
    .multilingual-voice-field select {
      width: 100%;
    }
    .multilingual-voice-result {
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.05);
      display: grid;
      gap: 8px;
    }
    @media (max-width: 900px) {
      .multilingual-voice-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

async function mvFetch(path, options = {}) {
  return multilingualVoiceFetch(path, options);
}

async function loadMultilingualVoiceStatus() {
  try {
    const res = await mvFetch("/api/plugins/multilingual-voice/status");
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "status unavailable");
    multilingualVoiceState.settings = json.settings || {};
    multilingualVoiceState.setup = json.setup || {};
    multilingualVoiceState.configured = json.configured === true;
    multilingualVoiceState.lastError = "";
  } catch (error) {
    multilingualVoiceState.lastError = String(error?.message || error || "status unavailable");
  }
  renderMultilingualVoice();
}

async function saveMultilingualVoiceSettings(patch = {}) {
  const res = await mvFetch("/api/plugins/multilingual-voice/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...multilingualVoiceState.settings, ...patch })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "failed to save settings");
  multilingualVoiceState.settings = json.settings || multilingualVoiceState.settings;
  multilingualVoiceState.setup = json.setup || multilingualVoiceState.setup;
  multilingualVoiceState.configured = Boolean(multilingualVoiceState.settings.whisperCommand || multilingualVoiceState.settings.modelPath);
  multilingualVoiceState.lastError = "";
  renderMultilingualVoice();
}

async function downloadDefaultModel() {
  if (multilingualVoiceState.downloading) return;
  multilingualVoiceState.downloading = true;
  multilingualVoiceState.lastError = "";
  renderMultilingualVoice();
  try {
    const urlInput = multilingualVoiceRoot?.querySelector('[data-mv-field="modelDownloadUrl"]');
    const res = await mvFetch("/api/plugins/multilingual-voice/download-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: urlInput?.value || multilingualVoiceState.settings.modelDownloadUrl || "" })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "model download failed");
    multilingualVoiceState.settings = json.settings || multilingualVoiceState.settings;
    multilingualVoiceState.setup = json.setup || multilingualVoiceState.setup;
    multilingualVoiceState.configured = true;
    multilingualVoiceState.lastError = `Downloaded model: ${Math.round(Number(json.bytes || 0) / 1024 / 1024)} MB`;
  } catch (error) {
    multilingualVoiceState.lastError = String(error?.message || error || "model download failed");
  } finally {
    multilingualVoiceState.downloading = false;
    renderMultilingualVoice();
  }
}

function getSupportedMimeType(preferred = "") {
  const choices = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ].filter(Boolean);
  return choices.find((value) => window.MediaRecorder?.isTypeSupported?.(value)) || "";
}

async function submitToNova(text, metadata = {}) {
  const msg = document.getElementById("msg");
  const runBtn = document.getElementById("runBtn");
  if (!msg || !runBtn) return;
  msg.value = String(text || "").trim();
  msg.dispatchEvent(new Event("input", { bubbles: true }));
  if (multilingualVoiceState.settings.autoSubmit !== false) {
    runBtn.click();
  }
}

async function transcribeBlob(blob) {
  const res = await mvFetch("/api/plugins/multilingual-voice/transcribe", {
    method: "POST",
    headers: {
      "content-type": blob.type || "application/octet-stream"
    },
    body: blob
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "transcription failed");
  multilingualVoiceState.lastResult = json;
  multilingualVoiceState.lastError = "";
  renderMultilingualVoice();
  await submitToNova(json.englishText || json.text || "", {
    ...(json.metadata || {}),
    englishText: json.englishText || json.text || ""
  });
}

function stopRecording() {
  const recorder = multilingualVoiceState.mediaRecorder;
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    multilingualVoiceState.lastError = "MediaRecorder microphone capture is unavailable in this browser.";
    renderMultilingualVoice();
    return;
  }
  if (multilingualVoiceState.recording) {
    stopRecording();
    return;
  }
  try {
    const settings = multilingualVoiceState.settings || {};
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const mimeType = getSupportedMimeType(settings.mimeType || "");
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    multilingualVoiceState.mediaRecorder = recorder;
    multilingualVoiceState.chunks = [];
    multilingualVoiceState.recording = true;
    multilingualVoiceState.startedAt = Date.now();
    multilingualVoiceState.lastError = "";
    recorder.ondataavailable = (event) => {
      if (event.data?.size) multilingualVoiceState.chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      window.clearTimeout(multilingualVoiceState.timer);
      multilingualVoiceState.recording = false;
      const blob = new Blob(multilingualVoiceState.chunks, { type: recorder.mimeType || "audio/webm" });
      multilingualVoiceState.chunks = [];
      renderMultilingualVoice();
      if (blob.size) {
        transcribeBlob(blob).catch((error) => {
          multilingualVoiceState.lastError = String(error?.message || error || "transcription failed");
          renderMultilingualVoice();
        });
      }
    };
    recorder.start();
    multilingualVoiceState.timer = window.setTimeout(stopRecording, Number(settings.recordingMaxMs || 12000));
    renderMultilingualVoice();
  } catch (error) {
    multilingualVoiceState.lastError = String(error?.message || error || "microphone capture failed");
    renderMultilingualVoice();
  }
}

function bindMainVoiceButtonInterception() {
  if (window.__multilingualVoiceButtonInterception) return;
  window.__multilingualVoiceButtonInterception = true;
  window.addEventListener("observer:voice:toggle-requested", (event) => {
    const settings = multilingualVoiceState.settings || {};
    if (!settings.enabled || !settings.interceptMainVoiceButton) return;
    event.preventDefault();
    startRecording();
  });
}

function renderMultilingualVoice() {
  if (!(multilingualVoiceRoot instanceof HTMLElement)) return;
  const settings = multilingualVoiceState.settings || {};
  const setup = multilingualVoiceState.setup || {};
  const result = multilingualVoiceState.lastResult || {};
  const lastRun = settings.lastRun || result.lastRun || null;
  const whisper = setup.tools?.whisper || {};
  const ffmpeg = setup.tools?.ffmpeg || {};
  const model = setup.model || {};
  multilingualVoiceRoot.innerHTML = `
    <section class="brain-editor-card multilingual-voice-stack">
      <div class="panel-head compact">
        <div>
          <h3>Multilingual Voice</h3>
          <div class="panel-subtle">${h(multilingualVoiceState.lastError || (multilingualVoiceState.configured ? "Local voice translation is configured." : "Configure local Whisper before recording."))}</div>
        </div>
        <button type="button" class="secondary" data-mv-refresh>Refresh</button>
      </div>
      <div class="multilingual-voice-row">
        <button type="button" ${settings.enabled === false ? "disabled" : ""} data-mv-record>${multilingualVoiceState.recording ? "Stop recording" : "Record command"}</button>
        <span class="summary-pill">${multilingualVoiceState.recording ? "Recording" : "Idle"}</span>
        <span class="summary-pill">${settings.autoSubmit !== false ? "Auto-submit" : "Draft only"}</span>
        <span class="summary-pill">${multilingualVoiceState.configured ? "Configured" : "Setup needed"}</span>
      </div>
    </section>
    <div class="multilingual-voice-grid">
      <section class="brain-editor-card multilingual-voice-stack">
        <div class="panel-head compact">
          <h3>Settings</h3>
          <button type="button" data-mv-save>Save</button>
        </div>
        <label class="toggle multilingual-voice-row">
          <span><strong>Enabled</strong><div class="micro">Allows the plugin to transcribe recordings.</div></span>
          <input type="checkbox" data-mv-field="enabled" ${settings.enabled !== false ? "checked" : ""} />
        </label>
        <label class="toggle multilingual-voice-row">
          <span><strong>Use main voice button</strong><div class="micro">When this tab has loaded, the core voice button records through this plugin.</div></span>
          <input type="checkbox" data-mv-field="interceptMainVoiceButton" ${settings.interceptMainVoiceButton === true ? "checked" : ""} />
        </label>
        <label class="toggle multilingual-voice-row">
          <span><strong>Auto-submit translated command</strong><div class="micro">Off leaves the translated text in the prompt box.</div></span>
          <input type="checkbox" data-mv-field="autoSubmit" ${settings.autoSubmit !== false ? "checked" : ""} />
        </label>
        <label class="multilingual-voice-field">
          <strong>Recording limit ms</strong>
          <input type="number" min="2000" max="60000" step="500" data-mv-field="recordingMaxMs" value="${h(String(settings.recordingMaxMs || 12000))}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>Whisper model path</strong>
          <input type="text" data-mv-field="modelPath" value="${h(settings.modelPath || model.path || "")}" placeholder="${h(model.runtimePath || "E:\\models\\ggml-small.bin")}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>Model download URL</strong>
          <input type="text" data-mv-field="modelDownloadUrl" value="${h(settings.modelDownloadUrl || model.downloadUrl || "")}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>Whisper binary</strong>
          <input type="text" data-mv-field="whisperBin" value="${h(settings.whisperBin || "whisper-cli")}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>Extra args</strong>
          <input type="text" data-mv-field="extraArgs" value="${h(settings.extraArgs || "-l auto -tr -nt")}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>ffmpeg path</strong>
          <input type="text" data-mv-field="ffmpegPath" value="${h(settings.ffmpegPath || "ffmpeg")}" />
        </label>
        <label class="multilingual-voice-field">
          <strong>Custom command</strong>
          <input type="text" data-mv-field="whisperCommand" value="${h(settings.whisperCommand || "")}" placeholder="optional: my-stt --input {input} --output {output}" />
        </label>
        <div class="multilingual-voice-row">
          <button type="button" class="secondary" ${multilingualVoiceState.downloading ? "disabled" : ""} data-mv-download-model>${multilingualVoiceState.downloading ? "Downloading..." : "Download base model"}</button>
        </div>
      </section>
      <section class="brain-editor-card multilingual-voice-stack">
        <div class="panel-head compact">
          <h3>Setup</h3>
          <span class="summary-pill">${h(setup.effective?.vendor?.platform || "local")}</span>
        </div>
        <div class="multilingual-voice-result">
          <strong>Whisper</strong>
          <div class="micro">${h(whisper.ok ? "detected" : "not detected")} | ${h(whisper.path || "")}</div>
          ${whisper.vendorExists ? `<div class="micro">Bundled: ${h(whisper.vendorPath || "")}</div>` : ""}
        </div>
        <div class="multilingual-voice-result">
          <strong>ffmpeg</strong>
          <div class="micro">${h(ffmpeg.ok ? "detected" : "not detected")} | ${h(ffmpeg.path || "")}</div>
          ${ffmpeg.vendorExists ? `<div class="micro">Bundled: ${h(ffmpeg.vendorPath || "")}</div>` : ""}
        </div>
        <div class="multilingual-voice-result">
          <strong>Model</strong>
          <div class="micro">${h(model.runtimeModelExists || model.vendorModelExists || settings.modelPath ? "available/configured" : "missing")} | ${h(model.path || model.runtimePath || "")}</div>
          ${model.vendorModelExists ? `<div class="micro">Bundled: ${h(model.vendorPath || "")}</div>` : ""}
        </div>
        <div class="panel-head compact">
          <h3>Last Translation</h3>
          <span class="summary-pill">${h(result.detectedLanguage || lastRun?.detectedLanguage || "auto")}</span>
        </div>
        ${result.englishText ? `
          <div class="multilingual-voice-result">
            <strong>English command</strong>
            <div class="history-body">${h(result.englishText)}</div>
            ${result.originalText && result.originalText !== result.englishText ? `<div class="micro">Original: ${h(result.originalText)}</div>` : ""}
          </div>
        ` : `<div class="panel-subtle">Record a command to see the translated text.</div>`}
        ${lastRun ? `
          <div class="multilingual-voice-result">
            <strong>Last run</strong>
            <div class="micro">${h(lastRun.ok ? "ok" : "failed")} | ${h(String(lastRun.durationMs || 0))} ms | ${h(lastRun.command || "")}</div>
            ${lastRun.stderrPreview ? `<div class="micro">${h(lastRun.stderrPreview)}</div>` : ""}
          </div>
        ` : ""}
      </section>
    </div>
  `;
  multilingualVoiceRoot.querySelector("[data-mv-refresh]")?.addEventListener("click", loadMultilingualVoiceStatus);
  multilingualVoiceRoot.querySelector("[data-mv-record]")?.addEventListener("click", startRecording);
  multilingualVoiceRoot.querySelector("[data-mv-download-model]")?.addEventListener("click", downloadDefaultModel);
  multilingualVoiceRoot.querySelector("[data-mv-save]")?.addEventListener("click", () => {
    const patch = {};
    multilingualVoiceRoot.querySelectorAll("[data-mv-field]").forEach((input) => {
      const key = input.dataset.mvField;
      if (input.type === "checkbox") {
        patch[key] = input.checked;
      } else if (input.type === "number") {
        patch[key] = Number(input.value || 0);
      } else {
        patch[key] = input.value;
      }
    });
    saveMultilingualVoiceSettings(patch).catch((error) => {
      multilingualVoiceState.lastError = String(error?.message || error || "failed to save settings");
      renderMultilingualVoice();
    });
  });
}

export async function mountPluginTab({ root, pluginAdminFetch }) {
  multilingualVoiceRoot = root;
  multilingualVoiceFetch = typeof pluginAdminFetch === "function" ? pluginAdminFetch : fetch;
  ensureMultilingualVoiceStyles();
  bindMainVoiceButtonInterception();
  renderMultilingualVoice();
  await loadMultilingualVoiceStatus();
}

export async function refreshPluginTab() {
  await loadMultilingualVoiceStatus();
}
