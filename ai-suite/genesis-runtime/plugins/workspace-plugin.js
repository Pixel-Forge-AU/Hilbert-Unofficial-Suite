// Extracted (simplified, not a mechanical port) from genesis-core's
// server/sandbox-workspace-service.js, observer-workspace-file-utils.js,
// observer-workspace-tracking.js, workspace-transaction-service.js, and
// workspace-transaction-composition.js.
//
// Depends on the sandbox plugin's capabilities ("sandbox:exec-node", "sandbox:read-file",
// "sandbox:write-file", "sandbox:list-files") for actual container filesystem access,
// rather than shelling out to Docker itself — this plugin owns "what is a project /
// what changed / is this edit safe", the sandbox plugin owns "how do I touch a file".
//
// The original project marker file was ".observer-project.json"; renamed here to
// ".genesis-project.json" — a deliberate breaking naming change from the Nova convention
// (existing Nova-workspace projects won't be auto-detected under the new name). Task/session
// identity threading (every transaction was keyed by Nova's taskId/sessionId) was replaced
// with a generic caller-supplied `ownerId` string, since Genesis core has no task concept of
// its own (that lives in the optional agent-runtime plugin, which may supply its task id as
// ownerId if it wants to, but workspace/transactions don't require one).

import crypto from "node:crypto";
import path from "node:path";

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 140, // after sandbox-plugin, before agent-runtime
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "workspace:list-projects", "workspace:inspect-project", "workspace:import-project",
      "workspace:archive-project", "workspace:track-files",
      "workspace:propose-transaction", "workspace:approve-transaction",
      "workspace:apply-transaction", "workspace:rollback-transaction"
    ],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: {
    requiredCapabilities: [],
    optionalCapabilities: ["sandbox:exec-node", "sandbox:read-file", "sandbox:write-file", "sandbox:list-files", "sandbox:run-shell"]
  },
  security: { isolation: "inprocess" }
};

const PROJECT_MARKER_FILE = ".genesis-project.json";
const HIGH_RISK_NAME_PATTERN = /(^|[\\/])\.env(\..+)?$|(^|[\\/])package(-lock)?\.json$|secret|credential|token|\.key$|\.pem$/i;

function sha256(content = "") {
  return crypto.createHash("sha256").update(String(content ?? "")).digest("hex");
}

function unifiedDiffPreview(before = "", after = "", context = 3) {
  const beforeLines = String(before ?? "").split("\n");
  const afterLines = String(after ?? "").split("\n");
  // A compact, dependency-free diff preview (not a full LCS diff) — good enough for an
  // approval UI to eyeball; not a replacement for a real diff library.
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const changes = [];
  for (let i = 0; i < maxLines; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      changes.push({ line: i + 1, before: beforeLines[i] ?? null, after: afterLines[i] ?? null });
    }
  }
  return changes.slice(0, 200);
}

function classifyRisk(filePath = "") {
  if (HIGH_RISK_NAME_PATTERN.test(String(filePath || ""))) {
    return "high";
  }
  return "normal";
}

const DEFAULT_WORKSPACE_ROOT = "/workspace";

// All project/transaction paths are meant to live under DEFAULT_WORKSPACE_ROOT inside the
// sandbox container (matching trackFiles' and archiveProject's own defaults below). Nothing
// otherwise stops a caller from pointing projectsRoot/projectPath/archiveRoot at an arbitrary
// container path, so every path-taking capability confines its input to that root.
function assertWithinWorkspace(candidatePath = "", root = DEFAULT_WORKSPACE_ROOT) {
  const normalized = path.posix.normalize(String(candidatePath || ""));
  if (!path.posix.isAbsolute(normalized) || (normalized !== root && !normalized.startsWith(`${root}/`))) {
    throw new Error(`path "${candidatePath}" is outside the workspace root (${root})`);
  }
  return normalized;
}

// Safely single-quote a value for interpolation into a sandbox:run-shell command string.
function shellQuoteSingle(value = "") {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export default function createWorkspacePlugin() {
  let api = null;

  function requireSandboxCapability(name) {
    const handler = api.getCapability(name);
    if (typeof handler !== "function") {
      throw new Error(`"${name}" capability is not available — install the sandbox plugin`);
    }
    return handler;
  }

  // --- Project listing (via sandbox:exec-node, matching the original's approach of
  // running a small Node script inside the container rather than shelling out per-call) ---

  async function listProjects({ projectsRoot = "/workspace/projects" } = {}) {
    const execNode = api.getCapability("sandbox:exec-node");
    if (typeof execNode !== "function") {
      return { available: false, projects: [] };
    }
    projectsRoot = assertWithinWorkspace(projectsRoot);
    const script = `
      const fs = require("fs/promises");
      const path = require("path");
      const root = ${JSON.stringify(projectsRoot)};
      const marker = ${JSON.stringify(PROJECT_MARKER_FILE)};
      (async () => {
        let entries = [];
        try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { entries = []; }
        const projects = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const projectPath = path.join(root, entry.name);
          try {
            const markerRaw = await fs.readFile(path.join(projectPath, marker), "utf8");
            const meta = JSON.parse(markerRaw);
            projects.push({ name: entry.name, path: projectPath, meta });
          } catch {
            // no marker file — not a recognized project, skip
          }
        }
        return projects;
      })().then(r => console.log(JSON.stringify(r)));
    `;
    // sandbox:exec-node's capability handler already returns the parsed JSON object the
    // container script printed (see sandbox-plugin.js's execNode()) -- it is NOT a
    // {stdout, stderr, code} shell-result shape like sandbox:run-shell's return value.
    const result = await execNode({ script });
    return { available: true, projects: Array.isArray(result) ? result : [] };
  }

  async function inspectProject({ projectPath = "" } = {}) {
    projectPath = assertWithinWorkspace(projectPath);
    const readFile = requireSandboxCapability("sandbox:read-file");
    const listFiles = requireSandboxCapability("sandbox:list-files");
    const [markerRaw, files] = await Promise.all([
      readFile({ filePath: `${projectPath}/${PROJECT_MARKER_FILE}` }).catch(() => null),
      listFiles({ rootPath: projectPath, maxDepth: 3 }).catch(() => [])
    ]);
    let meta = null;
    try { meta = markerRaw ? JSON.parse(markerRaw) : null; } catch { meta = null; }
    return { projectPath, meta, files };
  }

  async function importProject({ projectPath = "", name = "", description = "" } = {}) {
    projectPath = assertWithinWorkspace(projectPath);
    const writeFile = requireSandboxCapability("sandbox:write-file");
    const meta = { name: String(name || "").trim(), description: String(description || "").trim(), importedAt: new Date().toISOString() };
    await writeFile({ filePath: `${projectPath}/${PROJECT_MARKER_FILE}`, content: `${JSON.stringify(meta, null, 2)}\n` });
    return { ok: true, projectPath, meta };
  }

  async function archiveProject({ projectPath = "", archiveRoot = "" } = {}) {
    projectPath = assertWithinWorkspace(projectPath);
    const runShell = requireSandboxCapability("sandbox:run-shell");
    const target = assertWithinWorkspace(
      archiveRoot || `/workspace/archive/${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    const name = String(projectPath || "").split("/").filter(Boolean).pop() || "project";
    const command = `mkdir -p ${shellQuoteSingle(target)} && mv ${shellQuoteSingle(projectPath)} ${shellQuoteSingle(`${target}/${name}`)}`;
    const result = await runShell({ command });
    return { ok: true, archivedTo: `${target}/${name}`, raw: result };
  }

  // --- File-touch tracking: given free text (e.g. a tool transcript), find file path
  // mentions under a configured workspace root. ---

  function trackFiles({ text = "", workspaceRoot = "/workspace" } = {}) {
    const escapedRoot = String(workspaceRoot || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedRoot}\\/[^\\s"'\`]+`, "g");
    const matches = String(text || "").match(pattern) || [];
    return [...new Set(matches)];
  }

  // --- Transaction engine: propose/approve/apply/rollback, operating on file contents
  // passed in directly by the caller (via sandbox:read-file/write-file when applying) so
  // the risk-classification/diff/hash logic itself needs no sandbox capability and is
  // fully testable in isolation. ---

  async function loadTransactions() {
    return (await api.data.readJson("transactions", { byId: {} })) || { byId: {} };
  }

  async function saveTransactions(state) {
    await api.data.writeJson("transactions", state);
  }

  async function proposeTransaction({ ownerId = "", filePath = "", beforeContent = "", afterContent = "", basisHash = "" } = {}) {
    if (!filePath) throw new Error("filePath is required");
    const currentHash = sha256(beforeContent);
    if (basisHash && basisHash !== currentHash) {
      throw new Error("stale read: the provided basisHash does not match beforeContent — re-read the file before proposing an edit");
    }
    const risk = classifyRisk(filePath);
    const transaction = {
      id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId: String(ownerId || "").trim(),
      filePath,
      beforeContent,
      afterContent,
      beforeHash: currentHash,
      diff: unifiedDiffPreview(beforeContent, afterContent),
      risk,
      status: risk === "high" ? "pending_approval" : "approved",
      createdAt: new Date().toISOString(),
      appliedAt: null
    };
    const state = await loadTransactions();
    state.byId[transaction.id] = transaction;
    await saveTransactions(state);
    return transaction;
  }

  async function approveTransaction({ transactionId = "" } = {}) {
    const state = await loadTransactions();
    const transaction = state.byId[transactionId];
    if (!transaction) throw new Error(`transaction ${transactionId} not found`);
    transaction.status = "approved";
    await saveTransactions(state);
    return transaction;
  }

  async function applyTransaction({ transactionId = "" } = {}) {
    const state = await loadTransactions();
    const transaction = state.byId[transactionId];
    if (!transaction) throw new Error(`transaction ${transactionId} not found`);
    if (transaction.status !== "approved") {
      throw new Error(`transaction ${transactionId} is not approved (status: ${transaction.status})`);
    }
    const writeFile = requireSandboxCapability("sandbox:write-file");
    await writeFile({ filePath: transaction.filePath, content: transaction.afterContent });
    transaction.status = "applied";
    transaction.appliedAt = new Date().toISOString();
    await saveTransactions(state);
    return transaction;
  }

  async function rollbackTransaction({ transactionId = "" } = {}) {
    const state = await loadTransactions();
    const transaction = state.byId[transactionId];
    if (!transaction) throw new Error(`transaction ${transactionId} not found`);
    if (transaction.status !== "applied") {
      throw new Error(`transaction ${transactionId} was never applied (status: ${transaction.status})`);
    }
    const writeFile = requireSandboxCapability("sandbox:write-file");
    await writeFile({ filePath: transaction.filePath, content: transaction.beforeContent });
    transaction.status = "rolled_back";
    await saveTransactions(state);
    return transaction;
  }

  return {
    id: "workspace",
    name: "Workspace",
    version: "0.1.0",
    description: "Project discovery/import/archive and a safe file-edit transaction engine (propose/approve/apply/rollback with risk classification), built on top of the sandbox plugin's file primitives.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      api.provideCapability("workspace:list-projects", async (args = {}) => listProjects(args));
      api.provideCapability("workspace:inspect-project", async (args = {}) => inspectProject(args));
      api.provideCapability("workspace:import-project", async (args = {}) => importProject(args));
      api.provideCapability("workspace:archive-project", async (args = {}) => archiveProject(args));
      api.provideCapability("workspace:track-files", (args = {}) => trackFiles(args));
      api.provideCapability("workspace:propose-transaction", async (args = {}) => proposeTransaction(args));
      api.provideCapability("workspace:approve-transaction", async (args = {}) => approveTransaction(args));
      api.provideCapability("workspace:apply-transaction", async (args = {}) => applyTransaction(args));
      api.provideCapability("workspace:rollback-transaction", async (args = {}) => rollbackTransaction(args));
    },

    async registerRoutes({ app }) {
      app.get("/api/workspace/projects", async (req, res) => {
        try {
          res.json({ ok: true, ...(await listProjects({ projectsRoot: req.query?.projectsRoot })) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to list projects") });
        }
      });

      app.get("/api/workspace/projects/inspect", async (req, res) => {
        try {
          res.json({ ok: true, ...(await inspectProject({ projectPath: req.query?.projectPath })) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to inspect project") });
        }
      });

      app.post("/api/workspace/projects/import", async (req, res) => {
        try {
          res.json(await importProject(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to import project") });
        }
      });

      app.post("/api/workspace/projects/archive", async (req, res) => {
        try {
          res.json(await archiveProject(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to archive project") });
        }
      });

      app.post("/api/workspace/transactions", async (req, res) => {
        try {
          res.json({ ok: true, transaction: await proposeTransaction(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to propose transaction") });
        }
      });

      app.get("/api/workspace/transactions", async (_req, res) => {
        const state = await loadTransactions();
        res.json({ ok: true, transactions: Object.values(state.byId) });
      });

      app.post("/api/workspace/transactions/:transactionId/approve", async (req, res) => {
        try {
          res.json({ ok: true, transaction: await approveTransaction({ transactionId: req.params?.transactionId }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to approve transaction") });
        }
      });

      app.post("/api/workspace/transactions/:transactionId/apply", async (req, res) => {
        try {
          res.json({ ok: true, transaction: await applyTransaction({ transactionId: req.params?.transactionId }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to apply transaction") });
        }
      });

      app.post("/api/workspace/transactions/:transactionId/rollback", async (req, res) => {
        try {
          res.json({ ok: true, transaction: await rollbackTransaction({ transactionId: req.params?.transactionId }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to rollback transaction") });
        }
      });
    }
  };
}
