/**
 * Plugin Name: Dreaming
 * Plugin Slug: dreaming
 * Description: Curates generated memory files into long-term memory and trims low-value noise.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import { compactText } from "../observer-general-utils.js";

const DEFAULT_SCAN_LIMIT = 80;
const DEFAULT_MAX_BYTES_PER_FILE = 420_000;
const DEFAULT_LONG_TERM_FILE = "LONG-TERM-MEMORY.md";

function normalizeLine(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value = "") {
  return normalizeLine(value).slice(0, 220);
}

function isDateStampedMarkdown(fileName = "") {
  return /^\d{4}-\d{2}-\d{2}\.md$/i.test(String(fileName || "").trim());
}

function parseLimit(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeSectionName(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (/\b(prefer|preference|likes?|communication|style)\b/.test(text)) return "Preferences";
  if (/\b(project|priority|roadmap|ongoing)\b/.test(text)) return "Ongoing Projects";
  if (/\b(instruction|rule|always|never|should|must)\b/.test(text)) return "Standing Instructions";
  if (/\b(personal|relationship|private)\b/.test(text)) return "Personal Context";
  return "Stable Facts";
}

function classifyMemoryLine(line = "", context = {}) {
  const raw = String(line || "").trim();
  const stripped = raw.replace(/^\s*(?:[-*]\s+|\d+\.\s+|\[[ xX]\]\s*)+/, "").trim();
  const normalized = normalizeLine(stripped);
  const filePath = String(context.filePath || "").toLowerCase();
  const section = normalizeSectionName(context.heading || filePath);
  if (!stripped || stripped === "-" || stripped === "No briefing has been generated yet.") {
    return { kind: "trim", reason: "placeholder" };
  }
  if (stripped.length < 6) {
    return { kind: "trim", reason: "too_short" };
  }
  if (/^(daily record of|daily personal notes|no briefing|loading|loaded|none|n\/a|na|no active tasks|no pending tasks)/i.test(stripped)) {
    return { kind: "trim", reason: "generated_placeholder" };
  }
  if (/^i\s+(browsed|explored|decided to explore)\b/i.test(stripped) && /\b(recorded my findings|interesting article|new topic)\b/i.test(stripped)) {
    return { kind: "trim", reason: "generic_generated_personal_note" };
  }
  if (/^summary:/i.test(stripped)) {
    const explicitlyDurable = /\b(remember|long[- ]term|stable fact|standing instruction|preference|prefers?|always|never|ongoing project|current priority|user wants|user asked)\b/i.test(stripped);
    if (!explicitlyDurable) {
      return { kind: "keep", reason: "session_summary" };
    }
  }
  if (/^(model|tool loop|output files?|session|route|process codes?):/i.test(stripped)) {
    const explicitlyDurable = /\b(remember|long[- ]term|stable fact|standing instruction|preference|prefers?|always|never|ongoing project|current priority|user wants|user asked)\b/i.test(stripped);
    if (!explicitlyDurable) {
      return { kind: "trim", reason: "session_metadata" };
    }
  }
  if (/\b(process codes?|route:|session:|model:|tool loop:|output files?:|queue maintenance|native document sweep|idle workspace opportunity scan)\b/i.test(stripped)) {
    return { kind: "trim", reason: "operational_noise" };
  }
  if (/\b(error|failed|timeout|crash)\b/i.test(stripped) && !/\b(user prefers|remember|standing|long[- ]term|important)\b/i.test(stripped)) {
    return { kind: "keep", reason: "transient_error_context" };
  }
  if (/\b(remember|long[- ]term|stable fact|standing instruction|preference|prefers?|likes?|dislikes?|always|never|timezone|ongoing project|current priority|Nova should|user wants|user asked)\b/i.test(stripped)) {
    return {
      kind: "long_term",
      section,
      confidence: /\b(remember|standing instruction|always|never|prefers?|ongoing project)\b/i.test(stripped) ? 0.86 : 0.72,
      reason: "durable_memory_signal",
      text: compactText(stripped, 260)
    };
  }
  if (filePath.includes("\\personal\\") || filePath.includes("/personal/")) {
    if (/\b(feels?|likes?|relationship|personal|private|taste|prefers?)\b/i.test(stripped)) {
      return {
        kind: "long_term",
        section: "Personal Context",
        confidence: 0.68,
        reason: "personal_memory_signal",
        text: compactText(stripped, 260)
      };
    }
  }
  return { kind: "keep", reason: "not_durable_enough" };
}

function parseMarkdownLines(content = "", filePath = "") {
  const lines = String(content || "").split(/\r?\n/);
  const entries = [];
  let heading = "";
  const personalFile = /[\\/]personal[\\/]/i.test(String(filePath || ""));
  lines.forEach((line, index) => {
    const headingMatch = line.match(/^\s{0,3}#{1,4}\s+(.+?)\s*$/);
    if (headingMatch) {
      heading = String(headingMatch[1] || "").trim();
    }
    const bulletMatch = line.match(/^\s*(?:[-*]\s+|\d+\.\s+|\[[ xX]\]\s*)(.+?)\s*$/);
    const looksLikeMemorySentence = /\b(remember|prefer|standing|ongoing|priority|always|never|Nova should|user wants)\b/i.test(line);
    const personalNoteLine = personalFile && String(line || "").trim() && !headingMatch;
    if (bulletMatch || looksLikeMemorySentence || personalNoteLine || /^\s*-\s*$/.test(line)) {
      entries.push({
        lineNumber: index + 1,
        raw: line,
        text: bulletMatch ? String(bulletMatch[1] || "").trim() : String(line || "").trim(),
        heading,
        filePath
      });
    }
  });
  return entries;
}

function upsertSectionBullets(content = "", sectionName = "", bullets = []) {
  const normalizedSection = String(sectionName || "Stable Facts").trim() || "Stable Facts";
  const lines = String(content || "").replace(/\s*$/, "\n").split(/\r?\n/);
  const heading = `## ${normalizedSection}`;
  let start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push(heading, "");
    start = lines.length - 2;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const existingKeys = new Set(
    lines.slice(start + 1, end)
      .map((line) => line.match(/^\s*-\s+(.+?)\s*$/))
      .filter(Boolean)
      .map((match) => normalizeKey(match[1]))
      .filter(Boolean)
  );
  const insertLines = [];
  for (const bullet of bullets) {
    const text = compactText(String(bullet || "").trim(), 260);
    const key = normalizeKey(text);
    if (!text || !key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    insertLines.push(`- ${text}`);
  }
  if (!insertLines.length) {
    return String(content || "").replace(/\s*$/, "\n");
  }
  const insertAt = end;
  lines.splice(insertAt, 0, ...insertLines);
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

export function createDreamingPlugin(options = {}) {
  const {
    pluginId = "dreaming",
    pluginName = "Dreaming",
    description = "Curates generated memory files into long-term memory and trims low-value memory noise.",
    stateDataKey = "dreaming-state",
    longTermFileName = DEFAULT_LONG_TERM_FILE
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        capabilities: ["dreaming.scanMemory", "dreaming.applyMemoryCuration", "dreaming.getState"],
        hooks: ["cron:definitions:list", "intake:tools:list", "intake:tool-call"],
        runtimeContext: [
          "fs",
          "path",
          "promptFilesRoot",
          "promptMemoryDailyRoot",
          "promptMemoryCuratedPath",
          "promptPersonalPath",
          "promptStateStore",
          "promptWorkspaceRoot"
        ]
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
      const runtime = api.getRuntimeContext();
      const fs = runtime.fs;
      const path = runtime.path;
      const promptFilesRoot = runtime.promptFilesRoot;
      const promptMemoryDailyRoot = runtime.promptMemoryDailyRoot;
      const promptMemoryCuratedPath = runtime.promptMemoryCuratedPath || (promptFilesRoot && path ? path.join(promptFilesRoot, "MEMORY.md") : "");
      const stateFs = runtime.promptStateStore?.fs || fs;
      if (!fs || !path || !promptFilesRoot || !promptMemoryDailyRoot || !api.data) {
        return;
      }
      const longTermMemoryPath = path.join(promptFilesRoot, longTermFileName);
      const backupRoot = path.join(path.dirname(promptFilesRoot), "memory", ".dreaming-backups");

      async function readState() {
        const state = await api.data.readJson(stateDataKey, {});
        return {
          updatedAt: Number(state?.updatedAt || 0),
          lastScan: state?.lastScan && typeof state.lastScan === "object" ? state.lastScan : null,
          lastApply: state?.lastApply && typeof state.lastApply === "object" ? state.lastApply : null,
          processedLongTermKeys: Array.isArray(state?.processedLongTermKeys)
            ? state.processedLongTermKeys.map((entry) => String(entry || "").trim()).filter(Boolean).slice(-1000)
            : []
        };
      }

      async function writeState(nextState = {}) {
        const normalized = {
          ...nextState,
          updatedAt: Date.now()
        };
        await api.data.writeJson(stateDataKey, normalized);
        return normalized;
      }

      async function listMemoryFiles({ maxFiles = DEFAULT_SCAN_LIMIT, includeBriefings = false } = {}) {
        const roots = [
          { root: promptMemoryDailyRoot, kind: "daily" },
          { root: path.join(promptMemoryDailyRoot, "personal"), kind: "personal" },
          { root: path.join(promptMemoryDailyRoot, "questions"), kind: "questions" },
          includeBriefings ? { root: path.join(promptMemoryDailyRoot, "briefings"), kind: "briefings" } : null,
          { root: promptFilesRoot, kind: "prompt-files" }
        ].filter(Boolean);
        const files = [];
        for (const entry of roots) {
          const dirEntries = await stateFs.readdir(entry.root, { withFileTypes: true }).catch(() => []);
          for (const dirent of dirEntries) {
            if (!dirent.isFile() || !/\.md$/i.test(String(dirent.name || ""))) continue;
            if (entry.kind !== "prompt-files" && !isDateStampedMarkdown(dirent.name)) continue;
            if (entry.kind === "prompt-files" && !["SESSION-MEMORY.md", "MEMORY.md", "PERSONAL.md", "USER.md", longTermFileName].includes(dirent.name)) continue;
            const filePath = path.join(entry.root, dirent.name);
            const stat = await stateFs.stat(filePath).catch(() => null);
            files.push({
              path: filePath,
              kind: entry.kind,
              name: dirent.name,
              size: Number(stat?.size || 0),
              modifiedAt: Number(stat?.mtimeMs || 0)
            });
          }
        }
        return files
          .sort((left, right) => {
            const leftPrompt = left.kind === "prompt-files" ? 1 : 0;
            const rightPrompt = right.kind === "prompt-files" ? 1 : 0;
            if (leftPrompt !== rightPrompt) {
              return rightPrompt - leftPrompt;
            }
            return Number(right.modifiedAt || 0) - Number(left.modifiedAt || 0);
          })
          .slice(0, Math.max(1, Math.min(Number(maxFiles || DEFAULT_SCAN_LIMIT), 500)));
      }

      async function scanMemory(options = {}) {
        const maxFiles = parseLimit(options.maxFiles ?? options.max_files, DEFAULT_SCAN_LIMIT, 1, 500);
        const maxBytesPerFile = parseLimit(options.maxBytesPerFile ?? options.max_bytes_per_file, DEFAULT_MAX_BYTES_PER_FILE, 20_000, 2_000_000);
        const includeBriefings = options.includeBriefings === true || options.include_briefings === true || String(options.includeBriefings || options.include_briefings || "").toLowerCase() === "true";
        const files = await listMemoryFiles({ maxFiles, includeBriefings });
        const seenLongTerm = new Map();
        const trimCandidates = [];
        const scannedFiles = [];
        let scannedBytes = 0;
        for (const file of files) {
          const raw = await stateFs.readFile(file.path, "utf8").catch(() => "");
          const content = raw.length > maxBytesPerFile ? raw.slice(0, maxBytesPerFile) : raw;
          scannedBytes += Buffer.byteLength(content, "utf8");
          const lineEntries = parseMarkdownLines(content, file.path);
          const seenLinesInFile = new Set();
          let longTermCount = 0;
          let trimCount = 0;
          for (const entry of lineEntries) {
            const classified = classifyMemoryLine(entry.text || entry.raw, {
              filePath: file.path,
              heading: entry.heading
            });
            const key = normalizeKey(entry.text);
            if (key && seenLinesInFile.has(key) && classified.kind !== "long_term") {
              trimCandidates.push({
                filePath: file.path,
                lineNumber: entry.lineNumber,
                text: compactText(entry.text, 220),
                reason: "duplicate_in_file"
              });
              trimCount += 1;
              continue;
            }
            if (key) seenLinesInFile.add(key);
            if (classified.kind === "long_term") {
              const longTermKey = normalizeKey(classified.text);
              if (longTermKey && !seenLongTerm.has(longTermKey)) {
                seenLongTerm.set(longTermKey, {
                  key: longTermKey,
                  section: classified.section,
                  text: classified.text,
                  confidence: classified.confidence,
                  reason: classified.reason,
                  source: {
                    filePath: file.path,
                    lineNumber: entry.lineNumber,
                    heading: entry.heading
                  }
                });
              }
              longTermCount += 1;
            } else if (classified.kind === "trim") {
              trimCandidates.push({
                filePath: file.path,
                lineNumber: entry.lineNumber,
                text: compactText(entry.text || entry.raw, 220),
                reason: classified.reason
              });
              trimCount += 1;
            }
          }
          scannedFiles.push({
            path: file.path,
            kind: file.kind,
            size: file.size,
            sampledBytes: Buffer.byteLength(content, "utf8"),
            truncated: raw.length > content.length,
            longTermCount,
            trimCount
          });
        }
        const longTermCandidates = [...seenLongTerm.values()]
          .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))
          .slice(0, 120);
        const result = {
          at: Date.now(),
          scannedFiles,
          scannedBytes,
          longTermMemoryPath,
          curatedMemoryPath: promptMemoryCuratedPath,
          longTermCandidates,
          trimCandidates: trimCandidates.slice(0, 400),
          summary: {
            scannedFileCount: scannedFiles.length,
            longTermCandidateCount: longTermCandidates.length,
            trimCandidateCount: trimCandidates.length,
            truncatedFileCount: scannedFiles.filter((file) => file.truncated).length
          }
        };
        const state = await readState();
        await writeState({
          ...state,
          lastScan: {
            at: result.at,
            summary: result.summary,
            longTermPreview: longTermCandidates.slice(0, 20),
            trimPreview: trimCandidates.slice(0, 40)
          }
        });
        return result;
      }

      async function ensureLongTermMemoryFile() {
        await stateFs.mkdir(path.dirname(longTermMemoryPath), { recursive: true });
        const exists = await stateFs.stat(longTermMemoryPath).then(() => true).catch(() => false);
        if (!exists) {
          await stateFs.writeFile(longTermMemoryPath, [
            "# LONG-TERM-MEMORY.md",
            "",
            "Durable memory distilled from generated daily memory files.",
            "",
            "## Stable Facts",
            "",
            "## Preferences",
            "",
            "## Ongoing Projects",
            "",
            "## Standing Instructions",
            "",
            "## Personal Context",
            ""
          ].join("\n"), "utf8");
        }
      }

      async function applyTrims(trimCandidates = []) {
        const byFile = new Map();
        for (const candidate of trimCandidates) {
          const filePath = String(candidate?.filePath || "").trim();
          const lineNumber = Number(candidate?.lineNumber || 0);
          if (!filePath || lineNumber <= 0) continue;
          if (!byFile.has(filePath)) byFile.set(filePath, []);
          byFile.get(filePath).push(candidate);
        }
        const trimmedFiles = [];
        const staleCandidates = [];
        for (const [filePath, candidates] of byFile.entries()) {
          const original = await stateFs.readFile(filePath, "utf8").catch(() => "");
          if (!original) continue;
          const lines = original.split(/\r?\n/);
          // trimCandidates were computed by a prior scanMemory() call and may be stale by
          // the time apply runs (options.scan lets a caller pass an old scan result) -- only
          // remove a line whose current text still matches what was scanned, so a file edited
          // in between doesn't get an unrelated line deleted by raw line-index.
          const removeIndexes = new Set();
          for (const candidate of candidates) {
            const index = Number(candidate.lineNumber || 0) - 1;
            const currentLine = lines[index];
            if (currentLine === undefined || compactText(currentLine, 220) !== String(candidate.text || "")) {
              staleCandidates.push(candidate);
              continue;
            }
            removeIndexes.add(index);
          }
          const nextLines = lines.filter((_, index) => !removeIndexes.has(index));
          if (nextLines.length === lines.length) continue;
          await stateFs.mkdir(backupRoot, { recursive: true });
          const backupName = `${Date.now()}-${path.basename(filePath).replace(/[^a-z0-9._-]+/gi, "_")}`;
          const backupPath = path.join(backupRoot, backupName);
          await stateFs.writeFile(backupPath, original, "utf8");
          await stateFs.writeFile(filePath, `${nextLines.join("\n").replace(/\s+$/, "")}\n`, "utf8");
          trimmedFiles.push({
            filePath,
            backupPath,
            removedLineCount: lines.length - nextLines.length
          });
        }
        if (staleCandidates.length) {
          console.warn(`[genesis] dreaming plugin: skipped ${staleCandidates.length} stale trim candidate(s) whose line content changed since scan`);
        }
        return trimmedFiles;
      }

      async function applyMemoryCuration(options = {}) {
        const scan = options.scan && typeof options.scan === "object"
          ? options.scan
          : await scanMemory(options);
        const state = await readState();
        const processed = new Set(state.processedLongTermKeys);
        const applyTrim = options.applyTrim === true || options.apply_trim === true || String(options.applyTrim || options.apply_trim || "").toLowerCase() === "true";
        await ensureLongTermMemoryFile();
        let longTermContent = await stateFs.readFile(longTermMemoryPath, "utf8").catch(() => "");
        const added = [];
        const bySection = new Map();
        for (const candidate of Array.isArray(scan.longTermCandidates) ? scan.longTermCandidates : []) {
          const key = normalizeKey(candidate.text);
          if (!key || processed.has(key)) continue;
          if (!bySection.has(candidate.section)) bySection.set(candidate.section, []);
          bySection.get(candidate.section).push(candidate.text);
          processed.add(key);
          added.push(candidate);
        }
        for (const [section, bullets] of bySection.entries()) {
          longTermContent = upsertSectionBullets(longTermContent, section, bullets);
        }
        await stateFs.writeFile(longTermMemoryPath, longTermContent, "utf8");
        let curatedContent = await stateFs.readFile(promptMemoryCuratedPath, "utf8").catch(() => "");
        if (added.length) {
          curatedContent = upsertSectionBullets(curatedContent, "Stable Facts", [
            `Dreaming plugin curates generated memory into ${longTermFileName}.`
          ]);
          await stateFs.writeFile(promptMemoryCuratedPath, curatedContent, "utf8");
        }
        const trimmedFiles = applyTrim
          ? await applyTrims(Array.isArray(scan.trimCandidates) ? scan.trimCandidates : [])
          : [];
        const result = {
          at: Date.now(),
          longTermMemoryPath,
          addedLongTermCount: added.length,
          addedLongTerm: added.slice(0, 80),
          trimApplied: applyTrim,
          trimmedFiles,
          summary: {
            addedLongTermCount: added.length,
            trimmedFileCount: trimmedFiles.length,
            removedLineCount: trimmedFiles.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0)
          }
        };
        await writeState({
          ...state,
          processedLongTermKeys: [...processed].slice(-1000),
          lastApply: result,
          lastScan: state.lastScan
        });
        return result;
      }

      api.provideCapability("dreaming.scanMemory", scanMemory);
      api.provideCapability("dreaming.applyMemoryCuration", applyMemoryCuration);

      api.addHook("cron:definitions:list", async (payload = {}) => {
        const definitions = Array.isArray(payload?.definitions) ? payload.definitions.slice() : [];
        if (!definitions.some((entry) => String(entry?.id || "") === "dreaming-memory-curation")) {
          definitions.push({
            id: "dreaming-memory-curation",
            name: "Dreaming memory curation",
            message: "Dreaming memory curation: scan generated memory files, distill durable memories, and report trim candidates.",
            everyMs: 24 * 60 * 60 * 1000
          });
        }
        return { ...payload, definitions };
      });

      api.addHook("intake:tools:list", async (payload = {}) => ({
        ...payload,
        tools: [
          ...(Array.isArray(payload?.tools) ? payload.tools : []),
          {
            name: "dream_memory_scan",
            description: "Scan generated memory files for long-term memory candidates and safe trim candidates.",
            parameters: { maxFiles: "number", includeBriefings: "boolean" }
          },
          {
            name: "dream_memory_apply",
            description: "Apply a dreaming memory curation pass. By default it adds long-term memory only; pass applyTrim true to remove safe noise lines with backups.",
            parameters: { maxFiles: "number", applyTrim: "boolean" }
          }
        ]
      }));

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        if (name === "dream_memory_scan") {
          const result = await scanMemory(args);
          return {
            ...payload,
            handled: true,
            result: {
              text: `Dreaming scan found ${result.summary.longTermCandidateCount} long-term candidate(s) and ${result.summary.trimCandidateCount} trim candidate(s) across ${result.summary.scannedFileCount} file(s).`,
              result
            }
          };
        }
        if (name === "dream_memory_apply") {
          const result = await applyMemoryCuration(args);
          return {
            ...payload,
            handled: true,
            result: {
              text: `Dreaming applied ${result.summary.addedLongTermCount} long-term item(s)${result.trimApplied ? ` and removed ${result.summary.removedLineCount} noise line(s)` : ""}.`,
              result
            }
          };
        }
        return payload;
      });

      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "dreaming-memory-curation",
          title: "Dreaming Memory Curation",
          description: "Scan generated memory files, distill durable long-term memory, and optionally trim safe noise with backups.",
          fields: [
            { id: "max_files", label: "Max files", type: "number", defaultValue: DEFAULT_SCAN_LIMIT },
            { id: "include_briefings", label: "Include briefings", type: "checkbox", defaultValue: false },
            { id: "apply_trim", label: "Apply safe trims", type: "checkbox", defaultValue: false }
          ],
          actions: [
            {
              id: "state",
              label: "Refresh State",
              method: "GET",
              endpoint: "/api/plugins/dreaming/state",
              expects: "json"
            },
            {
              id: "scan",
              label: "Dry Run Scan",
              method: "POST",
              endpoint: "/api/plugins/dreaming/scan",
              bodyFields: ["max_files", "include_briefings"],
              expects: "json"
            },
            {
              id: "apply",
              label: "Apply Curation",
              method: "POST",
              endpoint: "/api/plugins/dreaming/apply",
              bodyFields: ["max_files", "include_briefings", "apply_trim"],
              confirm: "Apply dreaming curation? Long-term memory will be updated. Safe trims are backed up first when enabled.",
              expects: "json"
            }
          ]
        });
      }

      api.provideCapability("dreaming.getState", async () => ({
        state: await readState(),
        longTermMemoryPath,
        curatedMemoryPath: promptMemoryCuratedPath,
        backupRoot
      }));
    },
    async registerRoutes({ app, api }) {
      const getCap = (name) => api.getCapability(name);
      app.get("/api/plugins/dreaming/state", async (_req, res) => {
        try {
          const getState = getCap("dreaming.getState");
          if (typeof getState !== "function") {
            return res.status(503).json({ ok: false, error: "dreaming state capability is unavailable" });
          }
          res.json({ ok: true, ...(await getState()) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load dreaming state") });
        }
      });
      app.post("/api/plugins/dreaming/scan", async (req, res) => {
        try {
          const scan = getCap("dreaming.scanMemory");
          if (typeof scan !== "function") {
            return res.status(503).json({ ok: false, error: "dreaming scan capability is unavailable" });
          }
          res.json({ ok: true, result: await scan(req.body || {}) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to scan memory") });
        }
      });
      app.post("/api/plugins/dreaming/apply", async (req, res) => {
        try {
          const apply = getCap("dreaming.applyMemoryCuration");
          if (typeof apply !== "function") {
            return res.status(503).json({ ok: false, error: "dreaming apply capability is unavailable" });
          }
          res.json({ ok: true, result: await apply(req.body || {}) });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to apply memory curation") });
        }
      });
    }
  };
}
