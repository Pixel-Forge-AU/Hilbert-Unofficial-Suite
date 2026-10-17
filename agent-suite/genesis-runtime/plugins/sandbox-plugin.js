// Ported from genesis-core's server/observer-sandbox-service.js, sandbox-io-service.js
// and sandbox-state-store.js. Those three modules together implemented Nova/Observer's
// "run stuff inside an isolated Docker container" primitive: verify/create a long-running
// container, exec Node scripts inside it over `docker exec -i ... node -e`, and run shell
// commands / read+write files through that same channel.
//
// This plugin collapses them into one generic primitive with no Nova-specific coupling:
//   - no "promptWorkspaceRoot" host-mirroring concept (sandbox-state-store.js's dual
//     host-fs-or-container routing was Nova-specific; this plugin's read/write/list
//     capabilities always operate inside the container)
//   - no hardcoded "nova" user, ".observer-sandbox"-style volume name, or Nova image name;
//     all of that is now configuration persisted via api.data with generic defaults
//   - the container's directory bootstrap (memory/, projects/, skills/, etc.) was Nova
//     product structure and is NOT ported; this plugin only guarantees the configured
//     workspace/state/input/output roots exist
//
// The semantic-output-compression logic (output-semantic-compression.js) is ported
// faithfully and unmodified in behavior to ./sandbox-output-compression.js, and applied
// to "sandbox:run-shell" output the same way sandbox-io-service.js's runGatewayShell did.
//
// NOTE: container operations (docker inspect/run/start/exec) require a running Docker
// daemon and are untested in this environment. The `docker` CLI invocation shape is kept
// faithful to the original service. The compression logic has no Docker dependency and
// was sanity-checked directly.

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { compressShellResult } from "./sandbox-output-compression.js";

const DEFAULT_CONFIG = {
  image: "node:20-alpine",
  containerName: "genesis-sandbox",
  stateVolume: "genesis-sandbox-state",
  // Must exist as a user inside `image`, or be a numeric UID Docker can run as.
  // Nova hardcoded this to "nova"; Genesis defaults to a generic name instead.
  runtimeUser: "genesis",
  containerStateRoot: "/home/genesis/state",
  containerWorkspaceRoot: "/home/genesis/workspace",
  containerInputRoot: "/home/genesis/input",
  containerOutputRoot: "/home/genesis/output",
  // Host bind-mount roots. Left blank in stored config; resolved against os.tmpdir()
  // at runtime if not explicitly set (see resolveHostRoots()).
  inputHostRoot: "",
  outputHostRoot: "",
  memoryLimit: "2g",
  cpuLimit: "2.0",
  pidsLimit: 200
};

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 100,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "sandbox:ensure-container",
      "sandbox:exec-node",
      "sandbox:run-shell",
      "sandbox:read-file",
      "sandbox:write-file",
      "sandbox:list-files"
    ],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
  security: { isolation: "inprocess" }
};

// ============================================================================
// Process execution helper (child_process.spawn wrapper matching the shape the
// original service expected from its injected `runCommand`: { code, stdout, stderr })
// ============================================================================

function runCommand(command, args = [], { input, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timer = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    child.on("error", (error) => {
      finish({ code: -1, stdout, stderr: stderr || String(error?.message || error) });
    });

    child.on("close", (code) => {
      finish({ code: Number.isFinite(code) ? code : -1, stdout, stderr });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        finish({ code: -1, stdout, stderr: stderr || `command timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    }

    if (input !== undefined && input !== null) {
      child.stdin.write(String(input));
    }
    child.stdin.end();
  });
}

// ============================================================================
// Container-side Node script templates. Each script reads a JSON payload from
// stdin and writes a JSON result to stdout — same convention the original
// sandbox-io-service.js / sandbox-state-store.js scripts used.
// ============================================================================

const STDIN_JSON_PRELUDE = `
const readStdinJson = () => new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input || "{}"));
  process.stdin.on("error", reject);
});
`;

function scriptListFiles() {
  return `
const fs = require("fs/promises");
const path = require("path");
${STDIN_JSON_PRELUDE}
function shouldHideEntry(entryName) {
  return [".git", ".gitignore", ".gitattributes", ".gitmodules"].includes(entryName);
}
async function main() {
  const payload = JSON.parse(await readStdinJson());
  const entries = [];
  async function walk(currentPath, depth = 0) {
    const stat = await fs.stat(currentPath);
    const entryName = path.posix.basename(currentPath);
    if (depth > 0 && shouldHideEntry(entryName)) return;
    entries.push({ type: stat.isDirectory() ? "dir" : "file", path: currentPath, name: entryName });
    if (!stat.isDirectory() || depth >= (payload.maxDepth || 3)) return;
    const children = await fs.readdir(currentPath);
    for (const child of children.sort()) {
      await walk(path.posix.join(currentPath, child), depth + 1);
    }
  }
  await walk(payload.rootPath);
  process.stdout.write(JSON.stringify({ entries }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`;
}

function scriptReadFile() {
  return `
const fs = require("fs/promises");
${STDIN_JSON_PRELUDE}
async function main() {
  const payload = JSON.parse(await readStdinJson());
  const content = await fs.readFile(payload.filePath, "utf8");
  process.stdout.write(JSON.stringify({ content }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`;
}

function scriptWriteFile() {
  return `
const fs = require("fs/promises");
const path = require("path");
${STDIN_JSON_PRELUDE}
async function main() {
  const payload = JSON.parse(await readStdinJson());
  await fs.mkdir(path.posix.dirname(payload.filePath), { recursive: true });
  await fs.writeFile(payload.filePath, String(payload.content || ""), "utf8");
  process.stdout.write(JSON.stringify({ ok: true }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`;
}

// ============================================================================
// Plugin
// ============================================================================

export default function createSandboxPlugin() {
  let api = null;

  async function loadConfig() {
    const stored = await api.data.readJson("config", null);
    return { ...DEFAULT_CONFIG, ...(stored || {}) };
  }

  // These fields get interpolated into shell strings (buildStateBootstrapScript, the
  // container bootstrap command) and passed as Docker CLI arguments (mount destinations,
  // --user, -w). A value with a quote/metacharacter would let an admin-config write turn
  // into arbitrary shell execution (bootstrapStateVolume runs as --user 0), so every field
  // that ends up there is validated against a strict allowlist pattern before it's persisted.
  const CONFIG_FIELD_PATTERNS = {
    containerName: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    stateVolume: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    runtimeUser: /^[a-z_][a-z0-9_-]*$|^[0-9]+$/,
    containerStateRoot: /^\/[A-Za-z0-9_\-./]*$/,
    containerWorkspaceRoot: /^\/[A-Za-z0-9_\-./]*$/,
    containerInputRoot: /^\/[A-Za-z0-9_\-./]*$/,
    containerOutputRoot: /^\/[A-Za-z0-9_\-./]*$/
  };

  function isSafePosixPath(value = "") {
    return !String(value).split("/").includes("..");
  }

  function validateSandboxConfig(config = {}) {
    for (const [field, pattern] of Object.entries(CONFIG_FIELD_PATTERNS)) {
      const value = String(config[field] ?? "");
      if (!pattern.test(value) || !isSafePosixPath(value)) {
        throw new Error(`sandbox config field "${field}" has an invalid value (must match ${pattern})`);
      }
    }
  }

  async function saveConfig(nextConfig = {}) {
    const merged = { ...DEFAULT_CONFIG, ...nextConfig };
    validateSandboxConfig(merged);
    await api.data.writeJson("config", merged);
    return merged;
  }

  function resolveHostRoots(config) {
    const base = path.join(os.tmpdir(), "genesis-sandbox");
    return {
      inputHostRoot: String(config.inputHostRoot || "").trim() || path.join(base, "input"),
      outputHostRoot: String(config.outputHostRoot || "").trim() || path.join(base, "output")
    };
  }

  function buildExpectedMounts(config) {
    const { inputHostRoot, outputHostRoot } = resolveHostRoots(config);
    return [
      { type: "volume", name: config.stateVolume, destination: config.containerStateRoot, rw: true },
      { type: "bind", source: inputHostRoot, destination: config.containerInputRoot, rw: true },
      { type: "bind", source: outputHostRoot, destination: config.containerOutputRoot, rw: true }
    ];
  }

  async function inspectContainerDetails(config) {
    const result = await runCommand("docker", ["inspect", config.containerName], { timeoutMs: 10000 });
    if (result.code !== 0) return null;
    try {
      const parsed = JSON.parse(result.stdout || "[]");
      return parsed[0] || null;
    } catch {
      return null;
    }
  }

  function containerMatchesConfig(details, config) {
    if (!details) return false;
    if (String(details?.Config?.Image || "").trim() !== config.image) return false;
    if (String(details?.Config?.WorkingDir || "").trim() !== config.containerWorkspaceRoot) return false;
    if (String(details?.Config?.User || "").trim() !== config.runtimeUser) return false;
    const mounts = Array.isArray(details?.Mounts) ? details.Mounts : [];
    const expectedMounts = buildExpectedMounts(config);
    for (const expected of expectedMounts) {
      const match = mounts.find((mount) => {
        if (String(mount?.Type || "").trim() !== expected.type) return false;
        if (String(mount?.Destination || "").trim() !== expected.destination) return false;
        if (Boolean(mount?.RW) !== Boolean(expected.rw)) return false;
        if (expected.type === "volume") return String(mount?.Name || "").trim() === expected.name;
        return true;
      });
      if (!match) return false;
    }
    return true;
  }

  // Defense in depth alongside validateSandboxConfig(): safely single-quote a shell
  // argument even if this ever runs against a config that bypassed validation.
  function shellQuoteSingle(value = "") {
    return `'${String(value).replaceAll("'", `'\\''`)}'`;
  }

  function buildStateBootstrapScript(config) {
    return [
      `mkdir -p ${shellQuoteSingle(config.containerStateRoot)}`,
      `mkdir -p ${shellQuoteSingle(config.containerWorkspaceRoot)}`,
      `chown -R ${shellQuoteSingle(`${config.runtimeUser}:${config.runtimeUser}`)} ${shellQuoteSingle(config.containerStateRoot)}`
    ].join(" && ");
  }

  async function bootstrapStateVolume(config) {
    const result = await runCommand("docker", [
      "run", "--rm", "--user", "0",
      "-v", `${config.stateVolume}:${config.containerStateRoot}`,
      config.image,
      "sh", "-lc", buildStateBootstrapScript(config)
    ], { timeoutMs: 30000 });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to prepare sandbox state volume");
    }
  }

  async function ensureHostRoots(config) {
    if (!api.__fs) return;
    const { inputHostRoot, outputHostRoot } = resolveHostRoots(config);
    await api.__fs.mkdir(inputHostRoot, { recursive: true }).catch(() => {});
    await api.__fs.mkdir(outputHostRoot, { recursive: true }).catch(() => {});
  }

  async function ensureContainer() {
    const config = await loadConfig();
    await ensureHostRoots(config);
    await bootstrapStateVolume(config);

    const details = await inspectContainerDetails(config);
    if (details && containerMatchesConfig(details, config)) {
      if (details?.State?.Running) {
        return { containerName: config.containerName, status: "running", created: false };
      }
      const started = await runCommand("docker", ["start", config.containerName], { timeoutMs: 15000 });
      if (started.code === 0) {
        return { containerName: config.containerName, status: "started", created: false };
      }
    }
    if (details) {
      await runCommand("docker", ["rm", "-f", config.containerName], { timeoutMs: 15000 });
    }
    const { inputHostRoot, outputHostRoot } = resolveHostRoots(config);
    const dockerArgs = [
      "run", "-d",
      "--name", config.containerName,
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", String(config.pidsLimit),
      "--memory", String(config.memoryLimit),
      "--cpus", String(config.cpuLimit),
      "--user", config.runtimeUser,
      "--tmpfs", "/tmp",
      "-w", config.containerWorkspaceRoot,
      "-v", `${config.stateVolume}:${config.containerStateRoot}`,
      "-v", `${inputHostRoot}:${config.containerInputRoot}`,
      "-v", `${outputHostRoot}:${config.containerOutputRoot}`,
      config.image,
      "sh", "-lc", `mkdir -p ${shellQuoteSingle(config.containerWorkspaceRoot)} && sleep infinity`
    ];
    const created = await runCommand("docker", dockerArgs, { timeoutMs: 30000 });
    if (created.code !== 0) {
      throw new Error(created.stderr || "failed to start sandbox container");
    }
    return { containerName: config.containerName, status: "created", created: true };
  }

  async function execNode(script, payload = {}, { timeoutMs = 60000 } = {}) {
    const config = await loadConfig();
    await ensureContainer();
    const result = await runCommand("docker", [
      "exec", "-i", config.containerName, "node", "-e", script
    ], { input: JSON.stringify(payload || {}), timeoutMs });
    if (result.code !== 0) {
      throw new Error(result.stderr || `container command failed with exit code ${result.code}`);
    }
    try {
      return JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error("failed to parse container tool response");
    }
  }

  async function runShell(command, { timeoutMs = 60000, expectation = "", minDensity = 50 } = {}) {
    const config = await loadConfig();
    await ensureContainer();
    const result = await runCommand("docker", [
      "exec", "-i", config.containerName, "sh", "-lc", command
    ], { timeoutMs });

    const compressed = await compressShellResult(result, command, {
      expectation: expectation || "execute sandbox shell command",
      minDensity,
      stripRaw: false
    });

    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      semantic: compressed.semantic,
      modelFormat: compressed.modelFormat,
      validation: compressed.validation,
      metadata: compressed.metadata
    };
  }

  // The container has no other secrets in it (read-only rootfs, --cap-drop ALL), but
  // nothing about scriptReadFile/scriptWriteFile/scriptListFiles otherwise stops a caller
  // from reading/overwriting/listing arbitrary paths inside the container (e.g. anything
  // under containerStateRoot). Confine every path-taking capability to the workspace root
  // so "sandbox file access" actually means workspace-scoped file access.
  function resolveWorkspacePath(config, requestedPath = "") {
    const workspaceRoot = config.containerWorkspaceRoot;
    const normalized = path.posix.normalize(
      path.posix.isAbsolute(String(requestedPath || ""))
        ? String(requestedPath || "")
        : path.posix.join(workspaceRoot, String(requestedPath || ""))
    );
    if (normalized !== workspaceRoot && !normalized.startsWith(`${workspaceRoot}/`)) {
      throw new Error(`path "${requestedPath}" is outside the sandbox workspace root (${workspaceRoot})`);
    }
    return normalized;
  }

  async function readFile(filePath) {
    const config = await loadConfig();
    const resolvedPath = resolveWorkspacePath(config, filePath);
    const result = await execNode(scriptReadFile(), { filePath: resolvedPath }, { timeoutMs: 30000 });
    return String(result.content || "");
  }

  async function writeFile(filePath, content) {
    const config = await loadConfig();
    const resolvedPath = resolveWorkspacePath(config, filePath);
    await execNode(scriptWriteFile(), { filePath: resolvedPath, content: String(content || "") }, { timeoutMs: 30000 });
    return { ok: true, filePath: resolvedPath };
  }

  async function listFiles(rootPath, { maxDepth = 3 } = {}) {
    const config = await loadConfig();
    const resolvedPath = resolveWorkspacePath(config, rootPath || config.containerWorkspaceRoot);
    const result = await execNode(scriptListFiles(), { rootPath: resolvedPath, maxDepth }, { timeoutMs: 30000 });
    return Array.isArray(result.entries) ? result.entries : [];
  }

  async function getStatus() {
    const config = await loadConfig();
    const details = await inspectContainerDetails(config).catch(() => null);
    return {
      containerName: config.containerName,
      image: config.image,
      exists: Boolean(details),
      running: Boolean(details?.State?.Running),
      matchesConfig: containerMatchesConfig(details, config),
      config: {
        ...config,
        ...resolveHostRoots(config)
      }
    };
  }

  return {
    id: "sandbox",
    name: "Sandbox",
    version: "0.1.0",
    description: "Run commands and read/write files inside an isolated, resource-limited Docker container, with semantic compression applied to shell output.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      // fs is not part of the plugin API surface; use node:fs/promises directly for
      // host-side directory bootstrap (bind-mount roots), scoped under a private field
      // so ensureHostRoots() has a single place to no-op if it's ever unavailable.
      const { default: fsPromises } = await import("node:fs/promises");
      api.__fs = fsPromises;

      api.provideCapability("sandbox:ensure-container", async () => ensureContainer());
      api.provideCapability("sandbox:exec-node", async ({ script, payload, timeoutMs } = {}) => {
        if (!script) throw new Error("script is required");
        return execNode(script, payload || {}, { timeoutMs });
      });
      api.provideCapability("sandbox:run-shell", async ({ command, timeoutMs, expectation, minDensity } = {}) => {
        if (!command) throw new Error("command is required");
        return runShell(command, { timeoutMs, expectation, minDensity });
      });
      api.provideCapability("sandbox:read-file", async ({ filePath } = {}) => {
        if (!filePath) throw new Error("filePath is required");
        return { content: await readFile(filePath) };
      });
      api.provideCapability("sandbox:write-file", async ({ filePath, content } = {}) => {
        if (!filePath) throw new Error("filePath is required");
        return writeFile(filePath, content);
      });
      api.provideCapability("sandbox:list-files", async ({ rootPath, maxDepth } = {}) => {
        if (!rootPath) throw new Error("rootPath is required");
        return { entries: await listFiles(rootPath, { maxDepth }) };
      });
    },

    async registerRoutes({ app }) {
      app.get("/api/sandbox/status", async (_req, res) => {
        try {
          res.json({ ok: true, ...(await getStatus()) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to get sandbox status") });
        }
      });

      app.get("/api/sandbox/config", async (_req, res) => {
        try {
          res.json({ ok: true, config: await loadConfig() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read sandbox config") });
        }
      });

      app.post("/api/sandbox/config", async (req, res) => {
        try {
          res.json({ ok: true, config: await saveConfig(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to update sandbox config") });
        }
      });

      app.post("/api/sandbox/ensure", async (_req, res) => {
        try {
          res.json({ ok: true, ...(await ensureContainer()) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to ensure sandbox container") });
        }
      });

      // Ad-hoc debugging endpoint: run a shell command (default) or a raw Node script
      // inside the sandbox container and return its (compressed, for shell) output.
      app.post("/api/sandbox/exec", async (req, res) => {
        try {
          const body = req.body || {};
          if (body.script) {
            const result = await execNode(String(body.script), body.payload || {}, { timeoutMs: body.timeoutMs });
            return res.json({ ok: true, result });
          }
          const command = String(body.command || "").trim();
          if (!command) {
            return res.status(400).json({ ok: false, error: "command or script is required" });
          }
          const result = await runShell(command, {
            timeoutMs: body.timeoutMs,
            expectation: body.expectation,
            minDensity: body.minDensity
          });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "sandbox exec failed") });
        }
      });
    }
  };
}
