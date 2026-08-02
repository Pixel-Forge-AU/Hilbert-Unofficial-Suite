/**
 * Plugin Name: Multilingual Voice
 * Plugin Slug: multilingual-voice
 * Description: Optional local multilingual voice capture using a configurable Whisper command.
 * Version: 0.1.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const DEFAULT_MODEL_DOWNLOAD_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const DEFAULT_MODEL_FILE_NAME = "ggml-base.bin";

const DEFAULT_SETTINGS = {
  enabled: true,
  interceptMainVoiceButton: false,
  autoSubmit: true,
  recordingMaxMs: 12000,
  mimeType: "audio/webm;codecs=opus",
  ffmpegPath: process.env.NOVA_MULTILINGUAL_VOICE_FFMPEG || "ffmpeg",
  whisperCommand: process.env.NOVA_MULTILINGUAL_VOICE_COMMAND || "",
  whisperBin: process.env.NOVA_MULTILINGUAL_VOICE_BIN || "whisper-cli",
  modelPath: process.env.NOVA_MULTILINGUAL_VOICE_MODEL || "",
  modelDownloadUrl: process.env.NOVA_MULTILINGUAL_VOICE_MODEL_URL || DEFAULT_MODEL_DOWNLOAD_URL,
  extraArgs: "-l auto -tr -nt",
  outputMode: "whisper.cpp",
  lastRun: null
};

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled !== false,
    interceptMainVoiceButton: source.interceptMainVoiceButton === true,
    autoSubmit: source.autoSubmit !== false,
    recordingMaxMs: clampNumber(source.recordingMaxMs, 2000, 60000, DEFAULT_SETTINGS.recordingMaxMs),
    mimeType: String(source.mimeType || DEFAULT_SETTINGS.mimeType).trim() || DEFAULT_SETTINGS.mimeType,
    ffmpegPath: String(source.ffmpegPath || DEFAULT_SETTINGS.ffmpegPath).trim() || DEFAULT_SETTINGS.ffmpegPath,
    whisperCommand: String(source.whisperCommand || "").trim(),
    whisperBin: String(source.whisperBin || DEFAULT_SETTINGS.whisperBin).trim() || DEFAULT_SETTINGS.whisperBin,
    modelPath: String(source.modelPath || "").trim(),
    modelDownloadUrl: String(source.modelDownloadUrl || DEFAULT_SETTINGS.modelDownloadUrl).trim() || DEFAULT_SETTINGS.modelDownloadUrl,
    extraArgs: String(source.extraArgs || DEFAULT_SETTINGS.extraArgs).trim(),
    outputMode: ["stdout", "whisper.cpp"].includes(String(source.outputMode || "").trim())
      ? String(source.outputMode || "").trim()
      : DEFAULT_SETTINGS.outputMode,
    lastRun: source.lastRun && typeof source.lastRun === "object" ? source.lastRun : null
  };
}

function splitCommandLine(value = "") {
  const input = String(value || "").trim();
  if (!input) return [];
  const parts = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function replacePlaceholders(value = "", replacements = {}) {
  return String(value || "")
    .replaceAll("{input}", replacements.inputPath || "")
    .replaceAll("{output}", replacements.outputPath || "")
    .replaceAll("{outputBase}", replacements.outputBase || "")
    .replaceAll("{model}", replacements.modelPath || "");
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = windowlessTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill race
      }
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\nprocess timed out`.trim(), durationMs: Date.now() - startedAt });
    }, Number(options.timeoutMs || 120000));
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr: String(error?.message || error), durationMs: Date.now() - startedAt });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

function windowlessTimeout(fn, delayMs) {
  return setTimeout(fn, delayMs);
}

async function readRequestBody(req, maxBytes = MAX_AUDIO_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`audio upload exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function cleanTranscriptText(value = "") {
  return String(value || "")
    .replace(/\[[^\]]+\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWhisperOutput(stdout = "", txtOutput = "") {
  const textOutput = cleanTranscriptText(txtOutput || stdout);
  if (!textOutput) {
    return { originalText: "", englishText: "", detectedLanguage: "" };
  }
  try {
    const parsed = JSON.parse(stdout);
    const text = cleanTranscriptText(parsed?.text || parsed?.englishText || parsed?.translation || "");
    return {
      originalText: cleanTranscriptText(parsed?.originalText || parsed?.sourceText || text),
      englishText: text,
      detectedLanguage: String(parsed?.language || parsed?.detectedLanguage || "").trim()
    };
  } catch {
    return {
      originalText: textOutput,
      englishText: textOutput,
      detectedLanguage: ""
    };
  }
}

async function fileExists(fs, filePath = "") {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isLikelyPath(value = "") {
  return /[\\/]/.test(String(value || "")) || /^[a-z]:/i.test(String(value || ""));
}

function getVendorPaths() {
  const platform = process.platform === "win32"
    ? "windows-x64"
    : process.platform === "darwin"
      ? "macos"
      : "linux-x64";
  return {
    platform,
    whisperBin: process.platform === "win32"
      ? path.join(__dirname, "vendor", "whisper", platform, "whisper-cli.exe")
      : path.join(__dirname, "vendor", "whisper", platform, "whisper-cli"),
    ffmpeg: process.platform === "win32"
      ? path.join(__dirname, "vendor", "ffmpeg", platform, "ffmpeg.exe")
      : path.join(__dirname, "vendor", "ffmpeg", platform, "ffmpeg"),
    model: path.join(__dirname, "vendor", "models", DEFAULT_MODEL_FILE_NAME)
  };
}

async function resolveExecutablePath(fs, candidates = [], fallback = "") {
  for (const candidate of candidates.map((entry) => String(entry || "").trim()).filter(Boolean)) {
    if (!isLikelyPath(candidate)) {
      return candidate;
    }
    if (await fileExists(fs, candidate)) {
      return candidate;
    }
  }
  return fallback;
}

export function createMultilingualVoicePlugin(options = {}) {
  const {
    pluginId = "multilingual-voice",
    pluginName = "Multilingual Voice",
    description = "Optional local multilingual voice capture and translation."
  } = options;
  let apiRef = null;

  async function readSettings() {
    const stored = await apiRef.data.readJson("settings", DEFAULT_SETTINGS);
    return normalizeSettings(stored);
  }

  async function writeSettings(patch = {}) {
    const current = await readSettings();
    const next = normalizeSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
    await apiRef.data.writeJson("settings", next);
    return next;
  }

  function getRuntimeModelPath() {
    return apiRef.data.path("models/ggml-base", { extension: ".bin" });
  }

  async function resolveEffectivePaths(fs, settings = {}) {
    const vendor = getVendorPaths();
    const configuredWhisper = String(settings.whisperBin || "").trim();
    const configuredFfmpeg = String(settings.ffmpegPath || "").trim();
    const configuredModel = String(settings.modelPath || "").trim();
    const runtimeModel = getRuntimeModelPath();
    const modelPath = await (async () => {
      for (const candidate of [configuredModel, process.env.NOVA_MULTILINGUAL_VOICE_MODEL, runtimeModel, vendor.model]) {
        const value = String(candidate || "").trim();
        if (value && await fileExists(fs, value)) return value;
      }
      return configuredModel || runtimeModel;
    })();
    const whisperBin = await resolveExecutablePath(fs, [
      configuredWhisper && configuredWhisper !== "whisper-cli" ? configuredWhisper : "",
      process.env.NOVA_MULTILINGUAL_VOICE_BIN,
      vendor.whisperBin,
      configuredWhisper || "whisper-cli",
      "whisper-cli"
    ], configuredWhisper || "whisper-cli");
    const ffmpegPath = await resolveExecutablePath(fs, [
      configuredFfmpeg && configuredFfmpeg !== "ffmpeg" ? configuredFfmpeg : "",
      process.env.NOVA_MULTILINGUAL_VOICE_FFMPEG,
      vendor.ffmpeg,
      configuredFfmpeg || "ffmpeg",
      "ffmpeg"
    ], configuredFfmpeg || "ffmpeg");
    return {
      vendor,
      runtimeModel,
      whisperBin,
      ffmpegPath,
      modelPath
    };
  }

  async function buildSetupStatus(fs, settings = {}) {
    const effective = await resolveEffectivePaths(fs, settings);
    const [runtimeModelExists, vendorModelExists, vendorWhisperExists, vendorFfmpegExists] = await Promise.all([
      fileExists(fs, effective.runtimeModel),
      fileExists(fs, effective.vendor.model),
      fileExists(fs, effective.vendor.whisperBin),
      fileExists(fs, effective.vendor.ffmpeg)
    ]);
    const ffmpegCheck = await runProcess(effective.ffmpegPath, ["-version"], { timeoutMs: 6000 });
    const whisperCheck = settings.whisperCommand
      ? { ok: true, code: 0, stdout: "custom command configured", stderr: "", durationMs: 0 }
      : await runProcess(effective.whisperBin, ["--help"], { timeoutMs: 6000 });
    const configured = Boolean(settings.whisperCommand || effective.modelPath);
    return {
      configured,
      effective,
      model: {
        path: effective.modelPath,
        runtimePath: effective.runtimeModel,
        runtimeModelExists,
        vendorPath: effective.vendor.model,
        vendorModelExists,
        downloadUrl: settings.modelDownloadUrl || DEFAULT_MODEL_DOWNLOAD_URL
      },
      tools: {
        whisper: {
          path: settings.whisperCommand ? settings.whisperCommand : effective.whisperBin,
          ok: settings.whisperCommand ? true : whisperCheck.stdout || whisperCheck.stderr ? true : whisperCheck.ok,
          detail: cleanTranscriptText(`${whisperCheck.stdout || ""} ${whisperCheck.stderr || ""}`).slice(0, 500),
          vendorPath: effective.vendor.whisperBin,
          vendorExists: vendorWhisperExists
        },
        ffmpeg: {
          path: effective.ffmpegPath,
          ok: ffmpegCheck.ok || Boolean(ffmpegCheck.stdout || ffmpegCheck.stderr),
          detail: cleanTranscriptText(`${ffmpegCheck.stdout || ""} ${ffmpegCheck.stderr || ""}`).slice(0, 500),
          vendorPath: effective.vendor.ffmpeg,
          vendorExists: vendorFfmpegExists
        }
      }
    };
  }

  async function convertAudioIfNeeded(fs, settings, inputPath, wavPath) {
    const effective = await resolveEffectivePaths(fs, settings);
    if (!effective.ffmpegPath) {
      return inputPath;
    }
    const result = await runProcess(effective.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      wavPath
    ], { timeoutMs: 60000 });
    if (!result.ok || !(await fileExists(fs, wavPath))) {
      return inputPath;
    }
    return wavPath;
  }

  async function buildWhisperCommand(fs, settings, inputPath, outputBase) {
    const effective = await resolveEffectivePaths(fs, settings);
    const outputPath = `${outputBase}.txt`;
    const replacements = {
      inputPath,
      outputPath,
      outputBase,
      modelPath: effective.modelPath
    };
    if (settings.whisperCommand) {
      const parts = splitCommandLine(settings.whisperCommand).map((part) => replacePlaceholders(part, replacements));
      return { command: parts[0], args: parts.slice(1), outputPath };
    }
    if (!effective.modelPath || !(await fileExists(fs, effective.modelPath))) {
      throw new Error("Set or download a Whisper model in the Multilingual Voice plugin.");
    }
    return {
      command: effective.whisperBin,
      args: [
        "-m",
        effective.modelPath,
        "-f",
        inputPath,
        ...splitCommandLine(settings.extraArgs),
        "-otxt",
        "-of",
        outputBase
      ],
      outputPath
    };
  }

  async function transcribeAudio({ fs, audioBuffer, contentType = "" } = {}) {
    const settings = await readSettings();
    if (!settings.enabled) {
      throw new Error("Multilingual Voice is disabled.");
    }
    if (!audioBuffer?.length) {
      throw new Error("audio body is empty");
    }
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nova-multilingual-voice-"));
    const inputExt = /wav/i.test(contentType) ? ".wav" : /mp4|m4a/i.test(contentType) ? ".m4a" : ".webm";
    const inputPath = path.join(tempRoot, `capture${inputExt}`);
    const wavPath = path.join(tempRoot, "capture.wav");
    const outputBase = path.join(tempRoot, "transcript");
    try {
      await fs.writeFile(inputPath, audioBuffer);
      const whisperInputPath = await convertAudioIfNeeded(fs, settings, inputPath, wavPath);
      const whisper = await buildWhisperCommand(fs, settings, whisperInputPath, outputBase);
      const run = await runProcess(whisper.command, whisper.args, { timeoutMs: 180000 });
      const txtOutput = await fileExists(fs, whisper.outputPath)
        ? await fs.readFile(whisper.outputPath, "utf8")
        : "";
      const parsed = parseWhisperOutput(run.stdout, txtOutput);
      const lastRun = {
        ok: run.ok,
        code: run.code,
        durationMs: run.durationMs,
        command: whisper.command,
        args: whisper.args.map((arg) => arg === settings.modelPath ? "{model}" : arg),
        stderrPreview: cleanTranscriptText(run.stderr).slice(0, 800),
        detectedLanguage: parsed.detectedLanguage,
        textPreview: parsed.englishText.slice(0, 240),
        at: Date.now()
      };
      await writeSettings({ lastRun });
      if (!run.ok) {
        throw new Error(lastRun.stderrPreview || `Whisper exited with code ${run.code}`);
      }
      if (!parsed.englishText) {
        throw new Error("Whisper returned no transcript.");
      }
      return {
        ...parsed,
        metadata: {
          voiceProvider: pluginId,
          detectedLanguage: parsed.detectedLanguage,
          originalText: parsed.originalText,
          translated: true
        },
        lastRun
      };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function downloadDefaultModel(fs, requestedUrl = "") {
    const settings = await readSettings();
    const modelUrl = String(requestedUrl || settings.modelDownloadUrl || DEFAULT_MODEL_DOWNLOAD_URL).trim();
    if (!/^https:\/\//i.test(modelUrl)) {
      throw new Error("Model download URL must be HTTPS.");
    }
    const targetPath = getRuntimeModelPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const response = await fetch(modelUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`model download failed: HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 700 * 1024 * 1024) {
      throw new Error("model download is larger than the 700 MB safety limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 700 * 1024 * 1024) {
      throw new Error("model download is larger than the 700 MB safety limit");
    }
    if (bytes.length < 1024 * 1024) {
      throw new Error("downloaded model looks too small");
    }
    await fs.writeFile(targetPath, bytes);
    const nextSettings = await writeSettings({
      modelPath: targetPath,
      modelDownloadUrl: modelUrl
    });
    return {
      modelPath: targetPath,
      bytes: bytes.length,
      settings: nextSettings
    };
  }

  return {
    id: pluginId,
    name: pluginName,
    version: "0.1.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        capabilities: ["subsystem:classify"],
        hooks: ["intake:agent:run:request:received"],
        runtimeContext: ["noteInteractiveActivity"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      apiRef = api;
      api.provideCapability?.("subsystem:classify", (payload = {}) => {
        const pathname = String(payload?.path || "").trim().toLowerCase();
        const existing = Array.isArray(payload?.subsystems)
          ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
          : [];
        const next = new Set(existing);
        if (pathname.startsWith("/api/plugins/multilingual-voice/") || pathname.startsWith("/api/plugin-ui/multilingual-voice/")) {
          next.add("voice");
          next.add("intake");
        }
        return [...next];
      });
      api.addHook?.("intake:agent:run:request:received", async (payload = {}) => {
        const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
        if (metadata.voiceProvider !== pluginId || !metadata.englishText) {
          return payload;
        }
        return {
          ...payload,
          message: metadata.englishText,
          metadata
        };
      });
      api.registerUiTab?.({
        id: "multilingual-voice",
        title: "Multilingual Voice",
        icon: "MV",
        order: 19,
        scriptUrl: "/api/plugin-ui/multilingual-voice/tab.js"
      });
    },
    async registerRoutes({ app, api, fs }) {
      app.get("/api/plugin-ui/multilingual-voice/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "multilingual-voice-tab.js"));
      });

      app.get("/api/plugins/multilingual-voice/status", async (_req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const settings = await readSettings();
          const setup = await buildSetupStatus(fs, settings);
          res.json({
            ok: true,
            settings,
            configured: setup.configured,
            setup,
            at: Date.now()
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read multilingual voice status") });
        }
      });

      app.post("/api/plugins/multilingual-voice/settings", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const settings = await writeSettings(req.body || {});
          res.json({ ok: true, settings });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to save multilingual voice settings") });
        }
      });

      app.post("/api/plugins/multilingual-voice/download-model", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const result = await downloadDefaultModel(fs, req.body?.url || "");
          const setup = await buildSetupStatus(fs, result.settings);
          res.json({ ok: true, ...result, setup });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to download model") });
        }
      });

      app.post("/api/plugins/multilingual-voice/transcribe", async (req, res) => {
        try {
          api.getRuntimeContext()?.noteInteractiveActivity?.();
          const audioBuffer = await readRequestBody(req);
          const result = await transcribeAudio({
            fs,
            audioBuffer,
            contentType: req.headers["content-type"] || ""
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to transcribe audio") });
        }
      });
    }
  };
}

export default createMultilingualVoicePlugin;
