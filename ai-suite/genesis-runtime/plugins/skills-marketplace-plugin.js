// Extracted from genesis-core's server/skill-library.js (marketplace skills installed via
// `npx clawhub ...`), server/observer-agent-skills-service.js (JSON-defined "agent skills"
// with a system prompt, run against a configured LLM), and server/observer-agent-skill-routes.js.
//
// DESIGN DECISION — container vs. host:
// The original skill-library.js never shells out directly: it always runs `npx clawhub ...`
// *inside* a sandboxed Docker container (ensureObserverToolContainer / runObserverToolContainerNode)
// and reads results back through container-file helpers (readContainerFile/listContainerFiles).
// That container/sandbox layer was extracted separately by another agent and is not available
// here. For this extraction pass we run `npx clawhub ...` directly on the host via Node's
// child_process (spawn), wrapped in a Promise — see runClawhubCommand() below. This is a
// reasonable simplification for getting the plugin loading and its shape correct, but it means
// the marketplace CLI now executes third-party code with the same privileges as the Genesis
// process itself, with none of the sandbox's isolation. A real deployment should route
// runClawhubCommand() through a "sandbox:run-node"/"sandbox:exec" capability once a sandbox
// plugin exists, the same way secrets storage is meant to move behind a "secrets:*" capability.
// This is also entirely untested end-to-end: there is no guaranteed `npx`/network access to a
// real clawhub registry in this environment.
//
// DESIGN DECISION — brain:generate capability:
// observer-agent-skills-service.js imports `@dogpile/sdk` directly and builds an
// OpenAI-compatible provider itself to run a skill's system prompt against a configured "brain".
// This plugin does not import `@dogpile/sdk` or any model SDK — it has no direct model-provider
// dependency. Instead, running an agent skill calls the "brain:generate" capability via
// api.getCapability("brain:generate"), which a separate model-provider-plugin is expected to
// register. The assumed contract (undocumented elsewhere, so declared here) is:
//   await brainGenerate({ brainId, messages: [{role, content}, ...], input, systemPrompt })
//     -> { text, usage, costUsd }
// If no plugin has registered "brain:generate", calls fail with a clear, catchable error
// instead of crashing — this path is untested since no such capability is wired up yet.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function sanitizeSkillSlug(value = "") {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  // Every caller uses this as a single path.join() segment under skillsRoot; "." allows
  // dotfile-style slugs but must never resolve to "." or ".." (directory traversal).
  if (!sanitized || /^\.+$/.test(sanitized)) {
    return "";
  }
  return sanitized;
}

export function parseClawhubSearchResults(stdout = "") {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = line.match(/^([a-z0-9._-]+)\s+(.+?)\s+\(([\d.]+)\)$/i);
    if (!match) continue;
    results.push({ slug: match[1], summary: match[2], score: Number(match[3]) || 0 });
  }
  return results;
}

export function ensureClawhubCommandSucceeded(result, action = "clawhub command") {
  if (Number(result?.code) === 0) return result;
  const details = String(result?.stderr || result?.stdout || "").trim();
  throw new Error(details ? `${action} failed: ${details}` : `${action} failed`);
}

function parseInstalledSkillMetadata(content = "", safeSlug = "") {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const pickFrontmatter = (field) => {
    const pattern = new RegExp(`^${field}:\\s*(.+)$`, "mi");
    return String(text.match(pattern)?.[1] || "").trim();
  };
  let name = pickFrontmatter("name");
  let description = pickFrontmatter("description") || pickFrontmatter("summary");
  if (!name) {
    const heading = text.match(/^\s*#\s+(.+?)\s*$/m);
    name = String(heading?.[1] || "").trim();
  }
  if (!description) {
    const firstBodyLine = lines
      .map((line) => String(line || "").trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("```") && line !== "---" && !/^[A-Za-z0-9_.-]+:\s+/.test(line));
    description = String(firstBodyLine || "").trim();
  }
  return { name: name || safeSlug, description };
}

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 100,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "skills:search",
      "skills:inspect",
      "skills:install",
      "skills:list-installed",
      "skills:approve",
      "skills:revoke",
      "skills:guidance-note",
      "skills:list-agent-skills",
      "skills:search-agent-skills",
      "skills:get-agent-skill",
      "skills:save-agent-skill",
      "skills:run-agent-skill"
    ],
    hooks: [],
    runtimeContext: [],
    tools: ["search_skill_library", "install_skill", "run_agent_skill"]
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: ["brain:generate"] },
  security: { isolation: "inprocess" }
};

export default function createSkillsMarketplacePlugin() {
  let api = null;

  async function hook(name, payload) {
    if (!api || typeof api.runHook !== "function") return payload;
    try {
      const result = await api.runHook(name, payload);
      return result !== undefined ? result : payload;
    } catch {
      return payload;
    }
  }

  // ---- host workspace (replaces the container workspace the original used) ----

  function workspacePaths() {
    // api.data.path() namespaces under data/<pluginId>/<key><ext>; we only need the
    // directory, so anchor a marker file inside "workspace/" and take its dirname.
    const markerPath = api.data.path("workspace/marker");
    const workspaceRoot = path.dirname(markerPath);
    return {
      workspaceRoot,
      skillsRoot: path.join(workspaceRoot, "skills"),
      npmCacheDir: path.join(workspaceRoot, ".npm-cache"),
      homeDir: path.join(workspaceRoot, ".home")
    };
  }

  async function ensureWorkspaceDirs() {
    const paths = workspacePaths();
    await mkdir(paths.skillsRoot, { recursive: true });
    await mkdir(paths.npmCacheDir, { recursive: true });
    await mkdir(paths.homeDir, { recursive: true });
    return paths;
  }

  async function runClawhubCommand(args = [], { timeoutMs = 120000 } = {}) {
    const { workspaceRoot, npmCacheDir, homeDir } = await ensureWorkspaceDirs();
    const fullArgs = [
      "--yes",
      "--cache",
      npmCacheDir,
      "clawhub",
      "--no-input",
      "--workdir",
      workspaceRoot,
      "--dir",
      "skills",
      ...(Array.isArray(args) ? args.map(String) : [])
    ];
    return new Promise((resolve, reject) => {
      let settled = false;
      let child;
      try {
        child = spawn("npx", fullArgs, {
          cwd: workspaceRoot,
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
          windowsHide: true,
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            npm_config_cache: npmCacheDir
          }
        });
      } catch (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            reject(new Error(`clawhub command timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  // ---- approval registry (persisted via api.data, replaces readVolumeFile/writeVolumeText) ----

  async function loadSkillRegistryState() {
    const state = await api.data.readJson("registry", { approved: {} });
    return state && typeof state.approved === "object" && state.approved ? state : { approved: {} };
  }

  async function saveSkillRegistryState(state) {
    await api.data.writeJson("registry", state);
  }

  async function isApprovedInstalledSkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) return false;
    const state = await loadSkillRegistryState();
    return Boolean(state.approved?.[safeSlug]?.approvedAt);
  }

  async function approveInstalledSkill(slug = "", meta = {}) {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    const state = await loadSkillRegistryState();
    state.approved[safeSlug] = { approvedAt: Date.now(), source: "user-request", ...meta };
    await saveSkillRegistryState(state);
    await hook("skills:approved", { slug: safeSlug });
    return { slug: safeSlug, approved: true };
  }

  async function revokeInstalledSkillApproval(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    const state = await loadSkillRegistryState();
    if (state.approved?.[safeSlug]) {
      delete state.approved[safeSlug];
      await saveSkillRegistryState(state);
    }
    await hook("skills:revoked", { slug: safeSlug });
    return { slug: safeSlug, approved: false };
  }

  // ---- marketplace (clawhub) skills ----

  async function hostSkillExists(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    const { skillsRoot } = workspacePaths();
    try {
      await readFile(path.join(skillsRoot, safeSlug, "SKILL.md"), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async function searchSkillLibrary(query = "", limit = 6) {
    const trimmed = String(query || "").trim();
    if (!trimmed) throw new Error("query is required");
    // runClawhubCommand spawns npx with shell:true on Windows (required for the .cmd
    // shim); Node's own argv-escaping for shell:true has documented gaps on cmd.exe, so
    // this caller-controlled search query is restricted to a safe text charset rather
    // than trusting spawn() to escape shell metacharacters (&, |, ^, %, ", `, etc).
    if (!/^[\w\s.,'-]+$/.test(trimmed)) {
      throw new Error("query contains unsupported characters — use plain text, letters, numbers, spaces, and .,'- only");
    }
    const boundedLimit = Math.max(1, Math.min(12, Number(limit) || 6));
    const result = ensureClawhubCommandSucceeded(
      await runClawhubCommand(["search", trimmed, "--limit", String(boundedLimit)], { timeoutMs: 120000 }),
      "skill library search"
    );
    return { query: trimmed, results: parseClawhubSearchResults(result.stdout).slice(0, boundedLimit) };
  }

  async function inspectSkillLibrarySkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    const result = ensureClawhubCommandSucceeded(
      await runClawhubCommand(["inspect", safeSlug, "--json"], { timeoutMs: 120000 }),
      `skill library inspect for ${safeSlug}`
    );
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error("failed to parse skill inspection result");
    }
    const skill = parsed.skill || {};
    const latestVersion = parsed.latestVersion || {};
    const owner = skill.owner || {};
    return {
      slug: String(skill.slug || safeSlug),
      name: String(skill.displayName || skill.name || safeSlug),
      summary: String(skill.summary || ""),
      description: String(skill.description || skill.summary || ""),
      version: String(latestVersion.version || ""),
      owner: String(owner.handle || owner.name || ""),
      homepage: String(skill.homepage || ""),
      repoUrl: String(skill.repoUrl || ""),
      installed: await hostSkillExists(safeSlug),
      approved: await isApprovedInstalledSkill(safeSlug)
    };
  }

  async function inspectInstalledSkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    const { skillsRoot } = workspacePaths();
    const skillPath = path.join(skillsRoot, safeSlug, "SKILL.md");
    if (!(await hostSkillExists(safeSlug))) throw new Error(`skill ${safeSlug} is not installed`);
    const content = await readFile(skillPath, "utf8");
    const metadata = parseInstalledSkillMetadata(content, safeSlug);
    return {
      slug: safeSlug,
      name: String(metadata.name || safeSlug).trim(),
      description: String(metadata.description || "").trim(),
      skillPath,
      approved: await isApprovedInstalledSkill(safeSlug)
    };
  }

  async function installSkillIntoWorkspace(slug = "", { approvedByUser = false } = {}) {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) throw new Error("skill slug is required");
    ensureClawhubCommandSucceeded(
      await runClawhubCommand(["install", safeSlug, "--force"], { timeoutMs: 180000 }),
      `skill install for ${safeSlug}`
    );
    if (!(await hostSkillExists(safeSlug))) {
      throw new Error(`skill ${safeSlug} did not appear in the workspace after install`);
    }
    if (approvedByUser) {
      await approveInstalledSkill(safeSlug, { installRequestedAt: Date.now() });
    }
    const details = await inspectInstalledSkill(safeSlug);
    const result = {
      slug: safeSlug,
      installed: true,
      approved: await isApprovedInstalledSkill(safeSlug),
      skill: details
    };
    await hook("skills:installed", result);
    return result;
  }

  async function listInstalledSkills() {
    const { skillsRoot } = await ensureWorkspaceDirs();
    const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory || !entry.isDirectory()) continue;
      const slug = sanitizeSkillSlug(entry.name);
      if (!slug) continue;
      if (!(await hostSkillExists(slug))) continue;
      try {
        skills.push(await inspectInstalledSkill(slug));
      } catch {
        // skip malformed installed skills
      }
    }
    return skills.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async function buildGuidanceNote() {
    const { skillsRoot } = workspacePaths();
    const installed = (await listInstalledSkills()).filter((skill) => skill.approved);
    const agentSkills = await listAgentSkills();
    const lines = [];
    lines.push(`Installed marketplace skills directory: ${skillsRoot}`);
    if (installed.length) {
      lines.push("Only these explicitly user-approved marketplace skills are active guidance. Read only the relevant skill's SKILL.md when a task calls for it.");
      for (const skill of installed.slice(0, 12)) {
        lines.push(`- ${skill.slug}: ${skill.description || skill.name} (${skill.skillPath})`);
      }
    } else {
      lines.push("No approved marketplace skills are active right now. Only explicitly user-approved skills should be treated as operational guidance.");
    }
    if (agentSkills.length) {
      lines.push("Agent skills — call via the run_agent_skill tool (or skills:run-agent-skill capability):");
      for (const skill of agentSkills.slice(0, 20)) {
        lines.push(`- ${skill.id}: ${skill.description}`);
      }
    }
    return lines.join("\n");
  }

  // ---- agent skills (JSON system-prompt skills, persisted via api.data) ----

  async function loadAgentSkillsState() {
    const state = await api.data.readJson("agent-skills", { skills: {} });
    return state && typeof state.skills === "object" && state.skills ? state : { skills: {} };
  }

  async function saveAgentSkillsState(state) {
    await api.data.writeJson("agent-skills", state);
  }

  async function listAgentSkills() {
    const state = await loadAgentSkillsState();
    return Object.values(state.skills).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async function searchAgentSkills(query = "") {
    const skills = await listAgentSkills();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => {
      const name = String(s.name || "").toLowerCase();
      const desc = String(s.description || "").toLowerCase();
      const tags = Array.isArray(s.tags) ? s.tags.map((t) => String(t).toLowerCase()) : [];
      return name.includes(q) || desc.includes(q) || tags.some((t) => t.includes(q));
    });
  }

  async function getAgentSkill(id = "") {
    const state = await loadAgentSkillsState();
    return state.skills[sanitizeSkillSlug(id)] || null;
  }

  async function saveAgentSkill(def = {}) {
    const id = sanitizeSkillSlug(def.id || def.name || "");
    if (!id) throw new Error("skill id is required");
    const record = {
      id,
      name: String(def.name || id).trim().slice(0, 200) || id,
      description: String(def.description || "").trim().slice(0, 2000),
      tags: Array.isArray(def.tags) ? def.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
      systemPrompt: String(def.systemPrompt || "").trim(),
      inputDescription: String(def.inputDescription || "").trim(),
      preferredBrainId: String(def.preferredBrainId || "").trim() || undefined
    };
    const state = await loadAgentSkillsState();
    state.skills[id] = record;
    await saveAgentSkillsState(state);
    return record;
  }

  async function runAgentSkill({ skillId, id, input, brainId } = {}) {
    const skill = await getAgentSkill(skillId || id);
    if (!skill) throw new Error(`Agent skill not found: ${skillId || id}`);
    const trimmedInput = String(input || "").trim();
    if (!trimmedInput) throw new Error("input is required");

    const brainGenerate = api.getCapability("brain:generate");
    if (typeof brainGenerate !== "function") {
      throw new Error("brain:generate capability is not available - load/enable a model-provider plugin that provides it");
    }

    const targetBrainId = brainId || skill.preferredBrainId || undefined;
    const messages = [];
    if (skill.systemPrompt) messages.push({ role: "system", content: skill.systemPrompt });
    messages.push({ role: "user", content: trimmedInput });

    const result = await brainGenerate({
      brainId: targetBrainId,
      messages,
      input: trimmedInput,
      systemPrompt: skill.systemPrompt || undefined
    });

    const response = {
      skillId: skill.id,
      skillName: skill.name,
      brainId: targetBrainId || null,
      output: result?.text ?? result?.output ?? "",
      usage: result?.usage || null,
      costUsd: result?.costUsd || 0
    };
    await hook("skills:agent-skill:run", { skillId: skill.id, brainId: response.brainId });
    return response;
  }

  return {
    id: "skills-marketplace",
    name: "Skills Marketplace",
    version: "0.1.0",
    description: "Search, install, and approve marketplace skills (via `npx clawhub`), and run JSON-defined agent skills against a brain:generate capability.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;

      api.provideCapability("skills:search", async (args = {}) => searchSkillLibrary(args.query ?? args.q, args.limit));
      api.provideCapability("skills:inspect", async (args = {}) => inspectSkillLibrarySkill(args.slug));
      api.provideCapability("skills:install", async (args = {}) => installSkillIntoWorkspace(args.slug, { approvedByUser: args.approve === true || args.approvedByUser === true }));
      api.provideCapability("skills:list-installed", async () => listInstalledSkills());
      api.provideCapability("skills:approve", async (args = {}) => approveInstalledSkill(args.slug, args.meta || {}));
      api.provideCapability("skills:revoke", async (args = {}) => revokeInstalledSkillApproval(args.slug));
      api.provideCapability("skills:guidance-note", async () => buildGuidanceNote());

      api.provideCapability("skills:list-agent-skills", async () => listAgentSkills());
      api.provideCapability("skills:search-agent-skills", async (args = {}) => searchAgentSkills(args.query ?? args.q));
      api.provideCapability("skills:get-agent-skill", async (args = {}) => getAgentSkill(args.id ?? args.skillId));
      api.provideCapability("skills:save-agent-skill", async (args = {}) => saveAgentSkill(args));
      api.provideCapability("skills:run-agent-skill", async (args = {}) => runAgentSkill(args));

      api.registerTool({
        name: "search_skill_library",
        description: "Search the clawhub skill marketplace for installable skills matching a query.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" }
          },
          required: ["query"]
        },
        risk: "normal"
      });
      api.registerTool({
        name: "install_skill",
        description: "Install a skill from the clawhub marketplace into the local skills workspace. Executes third-party package code via `npx` - use with care.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string" },
            approve: { type: "boolean", description: "If true, mark the skill approved for use immediately after install." }
          },
          required: ["slug"]
        },
        risk: "high"
      });
      api.registerTool({
        name: "run_agent_skill",
        description: "Run a JSON-defined agent skill (a system prompt + input) against the configured brain:generate capability.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            input: { type: "string" },
            brainId: { type: "string" }
          },
          required: ["skillId", "input"]
        },
        risk: "medium"
      });
    },

    async registerRoutes({ app }) {
      app.get("/api/skills/search", async (req, res) => {
        try {
          res.json({ ok: true, ...(await searchSkillLibrary(req.query?.q, req.query?.limit)) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "search failed") });
        }
      });

      app.get("/api/skills/installed", async (_req, res) => {
        try {
          res.json({ ok: true, skills: await listInstalledSkills() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list installed skills") });
        }
      });

      app.get("/api/skills/guidance-note", async (_req, res) => {
        try {
          res.json({ ok: true, note: await buildGuidanceNote() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to build guidance note") });
        }
      });

      app.get("/api/skills/:slug/inspect", async (req, res) => {
        try {
          res.json({ ok: true, skill: await inspectSkillLibrarySkill(req.params?.slug) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "inspect failed") });
        }
      });

      app.post("/api/skills/:slug/install", async (req, res) => {
        try {
          const approve = req.body?.approve === true;
          res.json({ ok: true, ...(await installSkillIntoWorkspace(req.params?.slug, { approvedByUser: approve })) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "install failed") });
        }
      });

      app.post("/api/skills/:slug/approve", async (req, res) => {
        try {
          res.json({ ok: true, ...(await approveInstalledSkill(req.params?.slug, req.body?.meta || {})) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "approve failed") });
        }
      });

      app.post("/api/skills/:slug/revoke", async (req, res) => {
        try {
          res.json({ ok: true, ...(await revokeInstalledSkillApproval(req.params?.slug)) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "revoke failed") });
        }
      });

      app.get("/api/agent-skills", async (_req, res) => {
        try {
          res.json({ ok: true, skills: await listAgentSkills() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list agent skills") });
        }
      });

      app.get("/api/agent-skills/search", async (req, res) => {
        try {
          const query = String(req.query?.q || "").trim();
          res.json({ ok: true, query, skills: await searchAgentSkills(query) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to search agent skills") });
        }
      });

      app.get("/api/agent-skills/:id", async (req, res) => {
        try {
          const skill = await getAgentSkill(req.params?.id);
          if (!skill) return res.status(404).json({ ok: false, error: "Skill not found" });
          res.json({ ok: true, skill });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to get agent skill") });
        }
      });

      app.post("/api/agent-skills", async (req, res) => {
        try {
          res.json({ ok: true, skill: await saveAgentSkill(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save agent skill") });
        }
      });

      app.post("/api/agent-skills/:id/run", async (req, res) => {
        try {
          const { input, brainId } = req.body || {};
          if (!String(input || "").trim()) {
            return res.status(400).json({ ok: false, error: "input is required" });
          }
          res.json({ ok: true, ...(await runAgentSkill({ skillId: req.params?.id, input, brainId })) });
        } catch (err) {
          const message = String(err?.message || err || "failed to run agent skill");
          const status = message.includes("brain:generate capability is not available") ? 503 : 400;
          res.status(status).json({ ok: false, error: message });
        }
      });
    }
  };
}
