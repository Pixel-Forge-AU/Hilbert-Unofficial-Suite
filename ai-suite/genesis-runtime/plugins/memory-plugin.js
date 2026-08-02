// Ported from genesis-core's server/memory-trust-domain.js. That module mixed two concerns:
// (1) trust-record normalization, which now lives entirely in observer-compat/server/trust.js
// and is NOT re-ported here (see plugins that need trust concepts import it directly), and
// (2) a "prompt memory" system — markdown scaffolding, daily logs, a repair/success lesson
// journal, and a "question maintenance" mechanic for periodically asking the human to fill in
// gaps in USER.md/MEMORY.md/PERSONAL.md. This plugin ports (2) only.
//
// The original hardcoded a Docker sandbox path (/home/nova/.observer-sandbox/...) reachable
// only via container exec. That was already plain host filesystem I/O under the hood (fs.mkdir,
// fs.readFile, fs.writeFile, fs.appendFile) — no docker exec involved — so it ports directly to
// local disk here. The workspace root is resolved from this plugin's own scoped data directory
// via api.data.path(), not a fixed container path.
//
// Simplifications vs. the original:
// - Legacy-file migration/renaming logic in ensurePromptWorkspaceScaffolding (moving old
//   AGENTS.md/SOUL.md/TOOLS.md/MAIL-RULES.md root files into prompt-files/, migrating ad-hoc
//   project directories into projects/) was dropped — that existed to migrate real Nova
//   deployments off an older on-disk layout. A fresh Genesis plugin has no legacy layout to
//   migrate, so scaffolding here just creates the current directory/file layout directly.
// - backfillRecentMaintenanceMemory (which mined Nova's task-queue maintenance log for
//   "Closed/Advanced/Archived" lines and replayed them into the daily memory log) was dropped
//   entirely: it depends on a Nova task-queue subsystem (queueMaintenanceLogPath) that has no
//   Genesis equivalent and is out of scope for this extraction.
// - queryRepairLessons dropped the optional Qdrant vector-search augmentation
//   (context.searchChunks) since Genesis has no retrieval/indexing plugin yet. The keyword
//   scoring over LOOP-LESSONS.md blocks (the primary path) is preserved as-is.
// - The "question maintenance" rotation state (which targets were asked recently, the
//   round-robin cycle index) used to live on an external Nova task object
//   (task.recentQuestionTargetKeys / task.questionCycleIndex). Here it is persisted by this
//   plugin itself via api.data as small JSON state, since Genesis has no task-queue plugin to
//   own that state.
// - TODAY.md / briefings / AGENTS.md / SOUL.md / TOOLS.md / MAIL-RULES.md scaffolding was
//   dropped — those are other Nova subsystems' files (daily briefings, mail rules), not part of
//   the memory domain this extraction covers.
import fs from "node:fs/promises";
import path from "node:path";

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactTaskText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatDayKey(value = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    const day = parts.find((part) => part.type === "day")?.value || "00";
    return `${year}-${month}-${day}`;
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function formatTimeForUser(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(value).toString();
  }
}

function isValidDayKey(value = "") {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextOrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function appendVolumeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, content, "utf8");
}

async function ensureVolumeFile(filePath, content) {
  if (await fileExists(filePath)) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Pure markdown parsing/section-editing helpers. Ported verbatim (logic-wise)
// from memory-trust-domain.js — these are string-in/string-out and fully testable.
// ---------------------------------------------------------------------------

function normalizeMemoryBulletValue(value = "") {
  return compactTaskText(String(value || "").replace(/\s+/g, " ").trim(), 240);
}

function parseMarkdownFieldValue(content = "", label = "") {
  const pattern = new RegExp(`^\\s*-\\s*${escapeRegex(label)}:\\s*(.*)\\s*$`, "im");
  const match = String(content || "").match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function updateMarkdownFieldValue(content = "", label = "", value = "") {
  const normalizedValue = String(value || "").trim();
  const pattern = new RegExp(`^(\\s*-\\s*${escapeRegex(label)}:\\s*)(.*)$`, "im");
  if (pattern.test(String(content || ""))) {
    return String(content || "").replace(pattern, `$1${normalizedValue}`);
  }
  return String(content || "");
}

function getMarkdownSectionInfo(content = "", sectionTitle = "") {
  const lines = String(content || "").split(/\r?\n/);
  const heading = `## ${String(sectionTitle || "").trim()}`;
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return { lines, startIndex: -1, endIndex: lines.length, bullets: [] };
  }
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      endIndex = index;
      break;
    }
  }
  const bullets = lines
    .slice(startIndex + 1, endIndex)
    .map((line) => line.match(/^\s*-\s*(.*)\s*$/))
    .filter(Boolean)
    .map((match) => String(match[1] || "").trim())
    .filter((value) => value && value !== "-");
  return { lines, startIndex, endIndex, bullets };
}

function upsertMarkdownSectionBullet(content = "", sectionTitle = "", bulletValue = "", { replacePlaceholder = true } = {}) {
  const normalizedBullet = normalizeMemoryBulletValue(bulletValue);
  if (!normalizedBullet) return String(content || "");
  const { lines, startIndex, endIndex, bullets } = getMarkdownSectionInfo(content, sectionTitle);
  if (startIndex === -1) return String(content || "");
  if (bullets.some((entry) => entry.toLowerCase() === normalizedBullet.toLowerCase())) {
    return String(content || "");
  }
  if (replacePlaceholder) {
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      if (/^\s*-\s*$/.test(lines[index])) {
        lines[index] = `- ${normalizedBullet}`;
        return `${lines.join("\n").replace(/\s+$/, "")}\n`;
      }
    }
  }
  lines.splice(endIndex, 0, `- ${normalizedBullet}`);
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

// ---------------------------------------------------------------------------
// Question-maintenance targets/expansions. Ported verbatim; branding genericized.
// ---------------------------------------------------------------------------

const QUESTION_MAINTENANCE_TARGETS = [
  { key: "user_name", fileName: "USER.md", mode: "field", label: "Name", question: "What name should I record for you in USER.md?" },
  { key: "user_short_name", fileName: "USER.md", mode: "field", label: "Preferred short name", question: "What short name should I use for you by default?" },
  { key: "user_priorities", fileName: "USER.md", mode: "section", section: "Ongoing Priorities", question: "What is one current ongoing priority I should record for you?" },
  { key: "user_communication", fileName: "USER.md", mode: "section", section: "Communication Preferences", question: "How would you like me to present updates and results by default?" },
  { key: "memory_stable_facts", fileName: "MEMORY.md", mode: "section", section: "Stable Facts", question: "What is one stable fact about you or your situation that I should remember long-term?" },
  { key: "memory_preferences", fileName: "MEMORY.md", mode: "section", section: "Preferences", question: "What is one preference or workflow habit I should keep in MEMORY.md?" },
  { key: "memory_projects", fileName: "MEMORY.md", mode: "section", section: "Ongoing Projects", question: "Which ongoing project should I record as important right now?" },
  { key: "personal_preferences", fileName: "PERSONAL.md", mode: "section", section: "Personal Preferences", question: "What is one personal preference or taste I should remember?" },
  { key: "personal_standing_instructions", fileName: "PERSONAL.md", mode: "section", section: "Standing Instructions", question: "What is one standing instruction you want me to keep following automatically?" }
];

const QUESTION_MAINTENANCE_EXPANSIONS = [
  { key: "expand_priorities", fileName: "USER.md", mode: "section", section: "Ongoing Priorities", question: "What is another current priority I should keep in mind for you?" },
  { key: "expand_communication", fileName: "USER.md", mode: "section", section: "Communication Preferences", question: "What is another communication preference I should follow by default?" },
  { key: "expand_memory_projects", fileName: "MEMORY.md", mode: "section", section: "Ongoing Projects", question: "What is another ongoing project or area I should track in memory?" },
  { key: "expand_standing_instructions", fileName: "PERSONAL.md", mode: "section", section: "Standing Instructions", question: "What is another standing instruction or habit you want me to follow?" }
];

const ALL_QUESTION_MAINTENANCE_TARGETS = [...QUESTION_MAINTENANCE_TARGETS, ...QUESTION_MAINTENANCE_EXPANSIONS];

function getQuestionMaintenanceTargetState(target, fileContents) {
  const content = String(fileContents[target.fileName] || "");
  if (target.mode === "field") {
    return {
      complete: Boolean(parseMarkdownFieldValue(content, target.label)),
      currentValue: parseMarkdownFieldValue(content, target.label)
    };
  }
  const info = getMarkdownSectionInfo(content, target.section);
  return { complete: info.bullets.length > 0, currentValue: info.bullets.join("; ") };
}

function applyQuestionMaintenanceAnswer(target, answer, fileContents) {
  const normalizedAnswer = normalizeMemoryBulletValue(answer);
  if (!normalizedAnswer) {
    return { updated: false, fileContents, note: "Answer was empty." };
  }
  const nextContents = { ...fileContents };
  const existing = String(nextContents[target.fileName] || "");
  let updatedContent = existing;
  if (target.mode === "field") {
    updatedContent = updateMarkdownFieldValue(existing, target.label, normalizedAnswer);
  } else {
    updatedContent = upsertMarkdownSectionBullet(existing, target.section, normalizedAnswer, { replacePlaceholder: true });
  }
  if (updatedContent === existing) {
    return { updated: false, fileContents: nextContents, note: "Answer did not change the target file." };
  }
  nextContents[target.fileName] = updatedContent;
  return { updated: true, fileContents: nextContents, note: `Updated ${target.fileName}.` };
}

function chooseQuestionMaintenanceTarget(fileContents, state = {}) {
  const recentTargetKeys = new Set(
    Array.isArray(state.recentQuestionTargetKeys)
      ? state.recentQuestionTargetKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
  const incompleteTargets = [];
  for (const target of QUESTION_MAINTENANCE_TARGETS) {
    const targetState = getQuestionMaintenanceTargetState(target, fileContents);
    if (!targetState.complete) incompleteTargets.push(target);
  }
  const nextIncomplete = incompleteTargets.find((target) => !recentTargetKeys.has(target.key));
  if (nextIncomplete) return nextIncomplete;
  if (incompleteTargets.length) return incompleteTargets[0];
  const rotationIndex = Math.max(0, Number(state.questionCycleIndex || 0));
  const expansionTargets = QUESTION_MAINTENANCE_EXPANSIONS.filter((target) => !recentTargetKeys.has(target.key));
  const activeExpansions = expansionTargets.length ? expansionTargets : QUESTION_MAINTENANCE_EXPANSIONS;
  return activeExpansions[rotationIndex % activeExpansions.length] || activeExpansions[0] || null;
}

const MANIFEST = {
  schemaVersion: 1,
  // Loads early (before the default 100) and before dreaming-plugin.js/session-memory-plugin.js
  // specifically, both of which read fs/path/promptFilesRoot/promptMemoryDailyRoot off
  // api.getRuntimeContext() synchronously during their own init() and silently no-op if it's
  // not populated yet -- see the setRuntimeContext() call in this plugin's init() below.
  startupPriority: 30,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "memory:guidance-note",
      "memory:append-daily-note",
      "memory:append-lesson",
      "memory:query-lessons",
      "memory:record-question",
      "memory:answer-question"
    ],
    hooks: [],
    // "*" is required for setRuntimeContext() to be permitted at all (see hasManifestPermission
    // in lib/plugin-system.js) -- this plugin only ever WRITES fs/path/prompt-file-path keys,
    // it never reads runtimeContext itself.
    runtimeContext: ["*"],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
  security: { isolation: "inprocess" }
};

export default function createMemoryPlugin() {
  let api = null;
  let paths = null;

  function resolvePaths() {
    // api.data.path() always appends a .json extension and is meant for single files, but it
    // also gives us a real, collision-free per-plugin directory to anchor a whole tree under
    // (per the plugin contract: use path.dirname() on it to get a directory rather than a file).
    const workspaceRoot = path.dirname(api.data.path("workspace/.touch"));
    const promptFilesRoot = path.join(workspaceRoot, "prompt-files");
    const memoryDailyRoot = path.join(workspaceRoot, "memory");
    const memoryQuestionsRoot = path.join(workspaceRoot, "memory", "questions");
    return {
      workspaceRoot,
      promptFilesRoot,
      memoryDailyRoot,
      memoryQuestionsRoot,
      userPath: path.join(promptFilesRoot, "USER.md"),
      memoryCuratedPath: path.join(promptFilesRoot, "MEMORY.md"),
      personalPath: path.join(promptFilesRoot, "PERSONAL.md"),
      repairLessonsPath: path.join(promptFilesRoot, "LOOP-LESSONS.md"),
      successLessonsPath: path.join(promptFilesRoot, "SUCCESS-LESSONS.md")
    };
  }

  function buildPromptMemoryGuidanceNote(now = Date.now()) {
    const dayKey = formatDayKey(now);
    return [
      `Persistent memory workspace: ${paths.workspaceRoot}`,
      `Prompt files: ${paths.promptFilesRoot}`,
      `Daily memory log: ${path.join(paths.memoryDailyRoot, `${dayKey}.md`)}`,
      `Daily question log: ${path.join(paths.memoryQuestionsRoot, `${dayKey}.md`)}`,
      `Curated memory: ${paths.memoryCuratedPath}`,
      `Personal memory: ${paths.personalPath}`,
      `User profile: ${paths.userPath}`,
      "If a user asks you to remember something, or you establish a lasting preference, workflow, or standing instruction, update the relevant memory file instead of relying on session memory."
    ].join("\n");
  }

  async function ensurePromptWorkspaceScaffolding(now = Date.now()) {
    const dayKey = formatDayKey(now);
    await fs.mkdir(paths.promptFilesRoot, { recursive: true });
    await fs.mkdir(paths.memoryDailyRoot, { recursive: true });
    await fs.mkdir(paths.memoryQuestionsRoot, { recursive: true });
    await ensureVolumeFile(paths.userPath, [
      "# USER.md",
      "",
      "Core facts about the human this assistant is helping.",
      "",
      "## Identity",
      "",
      "- Name:",
      "- Preferred short name:",
      "- Timezone: Australia/Sydney",
      "",
      "## Ongoing Priorities",
      "",
      "-",
      "",
      "## Communication Preferences",
      "",
      "-",
      ""
    ].join("\n"));
    await ensureVolumeFile(paths.memoryCuratedPath, [
      "# MEMORY.md",
      "",
      "Curated long-term memory.",
      "",
      "## Stable Facts",
      "",
      "-",
      "",
      "## Preferences",
      "",
      "-",
      "",
      "## Ongoing Projects",
      "",
      "-",
      ""
    ].join("\n"));
    await ensureVolumeFile(paths.personalPath, [
      "# PERSONAL.md",
      "",
      "Private personal context, taste, and standing preferences that should persist over time.",
      "",
      "## Personal Preferences",
      "",
      "-",
      "",
      "## Relationships",
      "",
      "-",
      "",
      "## Standing Instructions",
      "",
      "-",
      ""
    ].join("\n"));
    await ensureVolumeFile(path.join(paths.memoryDailyRoot, `${dayKey}.md`), [
      `# ${dayKey}`,
      "",
      "## Highlights",
      "",
      "-",
      "",
      "## Decisions",
      "",
      "-",
      ""
    ].join("\n"));
    await ensureVolumeFile(path.join(paths.memoryQuestionsRoot, `${dayKey}.md`), [
      `# Question Log ${dayKey}`,
      "",
      "Daily record of incoming requests and the process codes they were attached to.",
      ""
    ].join("\n"));
  }

  async function readMaintenanceFileContents() {
    await ensurePromptWorkspaceScaffolding();
    const [userMd, memoryMd, personalMd] = await Promise.all([
      readTextOrEmpty(paths.userPath),
      readTextOrEmpty(paths.memoryCuratedPath),
      readTextOrEmpty(paths.personalPath)
    ]);
    return { "USER.md": userMd, "MEMORY.md": memoryMd, "PERSONAL.md": personalMd };
  }

  // ---- daily notes / question log --------------------------------------

  async function appendDailyOperationalMemory(title, lines = [], now = Date.now()) {
    const heading = compactTaskText(String(title || "").replace(/\s+/g, " ").trim(), 220);
    const bodyLines = Array.isArray(lines)
      ? lines.map((line) => compactTaskText(String(line || "").replace(/\s+/g, " ").trim(), 260)).filter(Boolean)
      : [];
    if (!heading || !bodyLines.length) return;
    const dayKey = formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = path.join(paths.memoryDailyRoot, `${dayKey}.md`);
    const entry = [
      "",
      `## Queue Maintenance ${formatTimeForUser(now)}`,
      `- Summary: ${heading}`,
      ...bodyLines.map((line) => `- ${line}`)
    ].join("\n");
    await appendVolumeText(logPath, `${entry}\n`);
  }

  async function appendDailyAssistantMemory(sectionTitle, title, lines = [], now = Date.now()) {
    const heading = compactTaskText(String(title || "").replace(/\s+/g, " ").trim(), 220);
    const bodyLines = Array.isArray(lines)
      ? lines.map((line) => compactTaskText(String(line || "").replace(/\s+/g, " ").trim(), 260)).filter(Boolean)
      : [];
    if (!heading || !bodyLines.length) return;
    const dayKey = formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = path.join(paths.memoryDailyRoot, `${dayKey}.md`);
    const entry = [
      "",
      `## ${compactTaskText(String(sectionTitle || "Operational Memory"), 80)} ${formatTimeForUser(now)}`,
      `- Summary: ${heading}`,
      ...bodyLines.map((line) => `- ${line}`)
    ].join("\n");
    await appendVolumeText(logPath, `${entry}\n`);
  }

  async function appendDailyNote({ sectionTitle = "", title = "", lines = [], now = Date.now() } = {}) {
    if (String(sectionTitle || "").trim()) {
      return appendDailyAssistantMemory(sectionTitle, title, lines, now);
    }
    return appendDailyOperationalMemory(title, lines, now);
  }

  async function appendDailyQuestionLog({ message, sessionId = "Main", route = "", taskRefs = [], notes = "" } = {}) {
    const text = compactTaskText(String(message || "").replace(/\s+/g, " ").trim(), 280);
    if (!text) return;
    const now = Date.now();
    const dayKey = formatDayKey(now);
    await ensurePromptWorkspaceScaffolding(now);
    const logPath = path.join(paths.memoryQuestionsRoot, `${dayKey}.md`);
    const processCodes = Array.isArray(taskRefs)
      ? taskRefs.map((task) => task?.codename || task?.id).filter(Boolean)
      : [];
    const entry = [
      "",
      `## ${formatTimeForUser(now)}`,
      `- Question: ${text}`,
      `- Session: ${String(sessionId || "Main").trim() || "Main"}`,
      `- Route: ${route || "unspecified"}`,
      `- Process codes: ${processCodes.join(", ") || "none"}`,
      notes ? `- Notes: ${compactTaskText(String(notes || "").replace(/\s+/g, " ").trim(), 280)}` : null
    ].filter(Boolean).join("\n");
    await appendVolumeText(logPath, `${entry}\n`);
  }

  // ---- lessons -----------------------------------------------------------

  async function appendSuccessLesson({
    timestamp = new Date().toISOString(),
    taskMessage = "",
    brainId = "",
    specialty = "",
    toolsUsed = [],
    changedFiles = 0
  } = {}) {
    try {
      const SUCCESS_CAP = 50;
      await fs.mkdir(paths.promptFilesRoot, { recursive: true });
      const compact = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n).trim();
      const existing = await readTextOrEmpty(paths.successLessonsPath);
      const fileHeader = "# Worker Success Patterns\n\nCompleted executions. Use these as examples of what worked.";
      const blocks = [];
      let current = [];
      for (const line of (existing || "").split("\n")) {
        if (line.startsWith("## ") && current.length) {
          blocks.push(current.join("\n").trim());
          current = [line];
        } else {
          current.push(line);
        }
      }
      if (current.length) blocks.push(current.join("\n").trim());
      const regularBlocks = blocks.filter((b) => b.startsWith("## "));
      const toolsUsedList = Array.isArray(toolsUsed) ? toolsUsed : [];
      const newEntry = [
        `## ${timestamp}`,
        compact(taskMessage, 200) ? `- Task: ${compact(taskMessage, 200)}` : "",
        brainId ? `- Brain: ${brainId}` : "",
        specialty ? `- Specialty: ${specialty}` : "",
        toolsUsedList.length ? `- Tools: ${toolsUsedList.slice(0, 6).join(", ")}` : "",
        changedFiles > 0 ? `- Changed files: ${changedFiles}` : "",
        ""
      ].filter(Boolean).join("\n");
      const pruned = [...regularBlocks, newEntry].slice(-SUCCESS_CAP);
      await fs.writeFile(paths.successLessonsPath, [fileHeader, ...pruned].filter(Boolean).join("\n") + "\n", "utf8");
      return { appended: true };
    } catch (err) {
      return { appended: false, error: String(err?.message || err) };
    }
  }

  async function appendRepairLesson({
    timestamp = new Date().toISOString(),
    taskMessage = "",
    repeatedCalls = "",
    repairNote = ""
  } = {}) {
    try {
      const LESSONS_CAP = 100;
      await fs.mkdir(paths.promptFilesRoot, { recursive: true });
      const compact = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n).trim();
      const existing = await readTextOrEmpty(paths.repairLessonsPath);
      const fileHeader = "# Loop Repair Lessons\n\nPatterns that caused tool loop repairs. Avoid repeating these.";
      const blocks = [];
      let current = [];
      for (const line of (existing || "").split("\n")) {
        if (line.startsWith("## ") && current.length) {
          blocks.push(current.join("\n").trim());
          current = [line];
        } else {
          current.push(line);
        }
      }
      if (current.length) blocks.push(current.join("\n").trim());
      const permanentBlocks = blocks.filter((b) => b.startsWith("## PERMANENT RULE"));
      const regularBlocks = blocks.filter((b) => b.startsWith("## ") && !b.startsWith("## PERMANENT RULE"));
      const newStuckTool = String(compact(repeatedCalls, 300) || "").split(/[\s,]/)[0].toLowerCase();
      const newRepairPrefix = compact(repairNote, 40).toLowerCase();
      const recentWindow = regularBlocks.slice(-20);
      const isDuplicate = newStuckTool && newRepairPrefix && recentWindow.some((block) => {
        const stuckMatch = block.match(/^- Stuck on: (.+)$/m);
        const repairMatch = block.match(/^- Repair: (.{0,40})/m);
        const stuckTool = String(stuckMatch?.[1] || "").split(/[\s,]/)[0].toLowerCase();
        const repairPrefix = String(repairMatch?.[1] || "").toLowerCase().slice(0, 40);
        return stuckTool === newStuckTool && repairPrefix === newRepairPrefix;
      });
      if (isDuplicate) {
        return { appended: false, reason: "duplicate" };
      }
      const newEntry = [
        `## ${timestamp}`,
        compact(taskMessage, 200) ? `- Task: ${compact(taskMessage, 200)}` : "",
        compact(repeatedCalls, 300) ? `- Stuck on: ${compact(repeatedCalls, 300)}` : "",
        repairNote ? `- Repair: ${compact(repairNote, 200)}` : "",
        ""
      ].filter(Boolean).join("\n");
      const updatedRegular = [...regularBlocks, newEntry];
      const pruned = updatedRegular.length > LESSONS_CAP ? updatedRegular.slice(-LESSONS_CAP) : updatedRegular;
      const parts = [fileHeader, ...permanentBlocks, ...pruned].filter(Boolean);
      await fs.writeFile(paths.repairLessonsPath, parts.join("\n") + "\n", "utf8");
      return { appended: true };
    } catch (err) {
      return { appended: false, error: String(err?.message || err) };
    }
  }

  async function appendLesson({ kind = "repair", ...rest } = {}) {
    const normalizedKind = String(kind || "repair").trim().toLowerCase();
    if (normalizedKind === "success") return appendSuccessLesson(rest);
    return appendRepairLesson(rest);
  }

  async function queryRepairLessons(keywords = []) {
    const normalized = (Array.isArray(keywords) ? keywords : [])
      .map((k) => String(k || "").toLowerCase().trim())
      .filter((k) => k.length >= 4);
    if (!normalized.length) return [];
    try {
      const content = await readTextOrEmpty(paths.repairLessonsPath);
      const trimmed = String(content || "").trim();
      if (!trimmed) return [];
      const blocks = [];
      let current = [];
      for (const line of trimmed.split("\n")) {
        if (line.startsWith("## ") && current.length) {
          blocks.push(current.join("\n").trim());
          current = [line];
        } else {
          current.push(line);
        }
      }
      if (current.length) blocks.push(current.join("\n").trim());
      const scored = blocks
        .filter((b) => b.startsWith("## ") && !b.startsWith("## PERMANENT RULE"))
        .map((block) => {
          const lower = block.toLowerCase();
          const score = normalized.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
          return { block, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, 3).map(({ block }) => block);
    } catch {
      return [];
    }
  }

  // ---- question maintenance -----------------------------------------------

  async function loadQuestionState() {
    return (await api.data.readJson("question-state", null)) || {
      recentQuestionTargetKeys: [],
      questionCycleIndex: 0,
      pending: null
    };
  }

  async function saveQuestionState(state) {
    await api.data.writeJson("question-state", state);
  }

  async function recordQuestion({ message, sessionId = "Main", route = "", taskRefs = [], notes = "", now = Date.now() } = {}) {
    await appendDailyQuestionLog({ message, sessionId, route, taskRefs, notes });
    const state = await loadQuestionState();
    const fileContents = await readMaintenanceFileContents();
    const target = chooseQuestionMaintenanceTarget(fileContents, state);
    if (!target) {
      return { logged: true, question: null, targetKey: null };
    }
    state.pending = { targetKey: target.key, question: target.question, fileName: target.fileName };
    await saveQuestionState(state);
    return { logged: true, question: target.question, targetKey: target.key, fileName: target.fileName };
  }

  async function answerQuestion({ targetKey = "", answer = "" } = {}) {
    const state = await loadQuestionState();
    const key = String(targetKey || "").trim() || state.pending?.targetKey || "";
    const target = ALL_QUESTION_MAINTENANCE_TARGETS.find((entry) => entry.key === key);
    if (!target) {
      throw new Error(`Unknown question maintenance target "${key || "(none pending)"}"`);
    }
    const fileContents = await readMaintenanceFileContents();
    const result = applyQuestionMaintenanceAnswer(target, answer, fileContents);
    if (result.updated) {
      await ensurePromptWorkspaceScaffolding();
      const targetPath = path.join(paths.promptFilesRoot, target.fileName);
      await fs.writeFile(targetPath, result.fileContents[target.fileName], "utf8");
      state.recentQuestionTargetKeys = [key, ...(state.recentQuestionTargetKeys || []).filter((k) => k !== key)].slice(0, 6);
      state.questionCycleIndex = Number(state.questionCycleIndex || 0) + 1;
      if (state.pending?.targetKey === key) state.pending = null;
      await saveQuestionState(state);
    }
    return { updated: result.updated, note: result.note, fileName: target.fileName, targetKey: key };
  }

  return {
    id: "memory",
    name: "Prompt Memory",
    version: "0.1.0",
    description: "Markdown-backed prompt memory: USER/MEMORY/PERSONAL profile files, daily operational and question logs, a repair/success lesson journal, and a question-maintenance rotation for filling in memory gaps.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      paths = resolvePaths();
      await ensurePromptWorkspaceScaffolding();

      // Several ported Nova plugins (dreaming-plugin.js, session-memory-plugin.js) still read
      // their prompt-file paths off api.getRuntimeContext() rather than a capability. Publish
      // this plugin's own already-resolved paths there so those plugins work without needing to
      // be rewritten -- see MANIFEST's startupPriority/runtimeContext comments above for why
      // this must run before them.
      api.setRuntimeContext({
        fs,
        path,
        promptFilesRoot: paths.promptFilesRoot,
        promptMemoryDailyRoot: paths.memoryDailyRoot,
        promptMemoryCuratedPath: paths.memoryCuratedPath,
        promptPersonalPath: paths.personalPath,
        promptWorkspaceRoot: paths.workspaceRoot
      });

      api.provideCapability("memory:guidance-note", async ({ now } = {}) => buildPromptMemoryGuidanceNote(now));
      api.provideCapability("memory:append-daily-note", async (args = {}) => appendDailyNote(args));
      api.provideCapability("memory:append-lesson", async (args = {}) => appendLesson(args));
      api.provideCapability("memory:query-lessons", async ({ keywords } = {}) => queryRepairLessons(keywords));
      api.provideCapability("memory:record-question", async (args = {}) => recordQuestion(args));
      api.provideCapability("memory:answer-question", async (args = {}) => answerQuestion(args));
    },

    async registerRoutes({ app }) {
      app.get("/api/memory/guidance-note", async (_req, res) => {
        try {
          res.json({ ok: true, note: buildPromptMemoryGuidanceNote() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to build guidance note") });
        }
      });

      app.get("/api/memory/files/:name", async (req, res) => {
        try {
          const name = String(req.params?.name || "");
          const allowed = { "USER.md": paths.userPath, "MEMORY.md": paths.memoryCuratedPath, "PERSONAL.md": paths.personalPath };
          const filePath = allowed[name];
          if (!filePath) {
            return res.status(404).json({ ok: false, error: `Unknown memory file "${name}". Expected one of ${Object.keys(allowed).join(", ")}.` });
          }
          await ensurePromptWorkspaceScaffolding();
          res.json({ ok: true, name, content: await readTextOrEmpty(filePath) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read memory file") });
        }
      });

      app.get("/api/memory/daily/:day?", async (req, res) => {
        try {
          const day = isValidDayKey(req.params?.day) ? req.params.day : formatDayKey();
          await ensurePromptWorkspaceScaffolding();
          const content = await readTextOrEmpty(path.join(paths.memoryDailyRoot, `${day}.md`));
          res.json({ ok: true, day, content });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read daily memory log") });
        }
      });

      app.get("/api/memory/questions/:day?", async (req, res) => {
        try {
          const day = isValidDayKey(req.params?.day) ? req.params.day : formatDayKey();
          await ensurePromptWorkspaceScaffolding();
          const content = await readTextOrEmpty(path.join(paths.memoryQuestionsRoot, `${day}.md`));
          res.json({ ok: true, day, content });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read question log") });
        }
      });

      app.get("/api/memory/lessons", async (req, res) => {
        try {
          const keywordsParam = String(req.query?.keywords || "").trim();
          if (keywordsParam) {
            const matches = await queryRepairLessons(keywordsParam.split(",").map((k) => k.trim()).filter(Boolean));
            return res.json({ ok: true, keywords: keywordsParam, matches });
          }
          await ensurePromptWorkspaceScaffolding();
          const [repair, success] = await Promise.all([
            readTextOrEmpty(paths.repairLessonsPath),
            readTextOrEmpty(paths.successLessonsPath)
          ]);
          res.json({ ok: true, repairLessons: repair, successLessons: success });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read lessons") });
        }
      });

      app.post("/api/memory/lessons", async (req, res) => {
        try {
          res.json({ ok: true, ...(await appendLesson(req.body || {})) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to append lesson") });
        }
      });

      app.post("/api/memory/daily-note", async (req, res) => {
        try {
          await appendDailyNote(req.body || {});
          res.json({ ok: true });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to append daily note") });
        }
      });

      app.post("/api/memory/questions", async (req, res) => {
        try {
          res.json({ ok: true, ...(await recordQuestion(req.body || {})) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to record question") });
        }
      });

      app.post("/api/memory/questions/answer", async (req, res) => {
        try {
          res.json({ ok: true, ...(await answerQuestion(req.body || {})) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to answer question") });
        }
      });
    }
  };
}
