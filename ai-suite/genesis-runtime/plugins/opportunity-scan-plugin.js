// A content port of observer-opportunity-domain.js's markdown-file-ranking idle scan,
// adapted to Genesis's actual capability surface instead of Nova's Docker-mounted
// "observer input" host root: this plugin uses sandbox-plugin.js's sandbox:list-files /
// sandbox:read-file capabilities (real container filesystem access) rather than direct
// fs calls against a hardcoded workspace-mount path.
//
// It listens on agent-runtime-plugin.js's "queue:idle" hook (an extension point, not a
// place this had to live in core) and, when enabled, returns `{ handled: true }` to take
// over from agent-runtime-plugin.js's own generic placeholder scan — this plugin's scan
// actually looks at real files instead of asking the model to imagine something to do.
// Off by default, same reasoning as the placeholder it replaces: autonomously creating
// tasks is a behavior change a user should opt into.

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 160,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [],
    hooks: ["queue:idle"],
    runtimeContext: []
  },
  dependencies: {
    requiredCapabilities: [],
    optionalCapabilities: ["tasks:create", "sandbox:list-files", "sandbox:read-file"]
  },
  security: { isolation: "inprocess" }
};

// Matches sandbox-plugin.js's own default containerWorkspaceRoot — resolveWorkspacePath()
// there rejects any path outside whatever root the sandbox is actually configured with, so
// this must track that default (and is overridable per-deployment via scanRoot in settings).
const DEFAULT_SCAN_ROOT = "/home/genesis/workspace";
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const PREFERRED_NAMES = new Map([
  ["agents.md", 220], ["todo.md", 200], ["tasks.md", 195], ["plan.md", 190],
  ["plans.md", 185], ["roadmap.md", 180], ["notes.md", 170], ["readme.md", 160]
]);

// Mirrors observer-opportunity-domain.js's scoreMarkdownPath, minus the container-mount
// path-relativization it did against Nova's specific workspace root.
function scoreMarkdownPath(entryPath = "") {
  const segments = String(entryPath || "").split("/").filter(Boolean);
  const baseName = (segments[segments.length - 1] || "").toLowerCase();
  let score = PREFERRED_NAMES.get(baseName) || 0;
  if (segments.length <= 2) score += 120;
  else if (segments.length <= 4) score += 70;
  if (/readme|changelog|license|contributing/i.test(baseName) && !PREFERRED_NAMES.has(baseName)) score -= 20;
  return score;
}

function extractHeadingAndSummary(content = "") {
  const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = (lines.find((line) => /^#{1,6}\s+/.test(line)) || "").replace(/^#{1,6}\s+/, "").trim();
  const summary = (lines.find((line) => !/^#{1,6}\s+/.test(line)) || "").slice(0, 140);
  return { heading, summary };
}

export default function createOpportunityScanPlugin() {
  let api = null;

  async function getSettings() {
    return (await api.data.readJson("settings", { enabled: false, intervalMs: DEFAULT_INTERVAL_MS, scanRoot: DEFAULT_SCAN_ROOT, lastScanAt: 0 }))
      || { enabled: false, intervalMs: DEFAULT_INTERVAL_MS, scanRoot: DEFAULT_SCAN_ROOT, lastScanAt: 0 };
  }

  async function updateSettings(patch = {}) {
    const settings = { ...(await getSettings()), ...patch };
    await api.data.writeJson("settings", settings);
    return settings;
  }

  async function onQueueIdle(payload = {}) {
    const settings = await getSettings();
    if (!settings.enabled) return payload;
    if (Date.now() - Number(settings.lastScanAt || 0) < Math.max(60000, Number(settings.intervalMs || DEFAULT_INTERVAL_MS))) return payload;

    const listFiles = api.getCapability("sandbox:list-files");
    const readFile = api.getCapability("sandbox:read-file");
    const createTask = api.getCapability("tasks:create");
    if (typeof listFiles !== "function" || typeof createTask !== "function") {
      return payload; // no sandbox / no agent-runtime installed — leave it to the default
    }
    await updateSettings({ lastScanAt: Date.now() });

    let entries = [];
    try {
      const result = await listFiles({ rootPath: settings.scanRoot || DEFAULT_SCAN_ROOT, maxDepth: 5 });
      entries = Array.isArray(result?.entries) ? result.entries : Array.isArray(result) ? result : [];
    } catch (err) {
      api.broadcast(`[opportunity-scan] sandbox:list-files failed: ${String(err?.message || err)}`);
      return payload;
    }

    const markdownFiles = entries
      .filter((entry) => (entry?.type ? entry.type === "file" : !entry?.isDirectory))
      .map((entry) => String(entry?.path || entry?.name || "").trim())
      .filter((path) => /\.mdx?$/i.test(path));
    if (!markdownFiles.length) return payload;

    const ranked = markdownFiles
      .map((path) => ({ path, score: scoreMarkdownPath(path) }))
      .sort((left, right) => right.score - left.score);
    const top = ranked[0];

    let heading = "";
    let summary = "";
    if (typeof readFile === "function") {
      try {
        const content = await readFile({ filePath: top.path });
        ({ heading, summary } = extractHeadingAndSummary(typeof content === "string" ? content : content?.content || ""));
      } catch {
        // proceed without a heading/summary — the path alone is still a usable opportunity
      }
    }

    const task = await createTask({
      request: `Review ${top.path}${heading ? ` (heading: "${heading}")` : ""} and carry out the highest-value concrete next step you find there.${summary ? ` Context: ${summary}` : ""}`
    });
    api.broadcast(`[opportunity-scan] queued review of ${top.path} as ${task.id}`);
    return { ...payload, handled: true };
  }

  return {
    id: "opportunity-scan",
    name: "Opportunity Scan",
    version: "0.1.0",
    description: "Opt-in idle-time scan of real workspace markdown files for follow-up work, replacing agent-runtime-plugin.js's generic placeholder scan.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      api.addHook("queue:idle", onQueueIdle);
    },

    async registerRoutes({ app }) {
      app.get("/api/opportunity-scan/settings", async (_req, res) => {
        res.json({ ok: true, settings: await getSettings() });
      });
      app.post("/api/opportunity-scan/settings", async (req, res) => {
        try {
          const patch = {};
          if (req.body?.enabled != null) patch.enabled = Boolean(req.body.enabled);
          if (req.body?.intervalMs != null) patch.intervalMs = Math.max(60000, Number(req.body.intervalMs));
          if (req.body?.scanRoot != null) patch.scanRoot = String(req.body.scanRoot).trim() || DEFAULT_SCAN_ROOT;
          res.json({ ok: true, settings: await updateSettings(patch) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to update settings") });
        }
      });
    }
  };
}
