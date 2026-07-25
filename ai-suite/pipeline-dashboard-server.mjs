#!/usr/bin/env node
// Control-plane dashboard for the planner -> implementation-orchestrator -> OpenHands pipeline.
// Normally started via `ai-switch pipeline-dashboard` (see ai_manager.py), which sets the env
// vars below from config.env. Run standalone with: node pipeline-dashboard-server.mjs
// Then open http://localhost:39016 (or DASHBOARD_PORT) in your browser.

import { createServer } from "node:http";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// planner-pipeline/implementation-orchestrator are siblings of this script by default (as laid
// out by install.sh); override via env if you keep them elsewhere.
const PLANNER_DIR = process.env.PLANNER_DIR ?? path.join(SCRIPT_DIR, "planner-pipeline");
const ORCHESTRATOR_DIR = process.env.ORCHESTRATOR_DIR ?? path.join(SCRIPT_DIR, "implementation-orchestrator");
const PLANNER_ENV = path.join(PLANNER_DIR, ".env");
const ORCHESTRATOR_ENV = path.join(ORCHESTRATOR_DIR, ".env");
const WORKSPACE_MOUNT = process.env.WORKSPACE_MOUNT ?? path.join(SCRIPT_DIR, "orchestrator-workspaces");

// NOTE: `ai-switch openhands` runs a *native* agent-server process (see ai_manager.py) bound to
// OPENHANDS_PORT. The Docker controls below are an alternative way to run the same agent-server
// package in a container instead - use one or the other, not both, to avoid two instances
// fighting over the same repo/workspace. Docker is mapped onto the same OPENHANDS_PORT by default
// so whichever path you pick, the rest of this dashboard (and the URLs below) keep working unchanged.
const OPENHANDS_CONTAINER = process.env.OPENHANDS_CONTAINER ?? "ai-suite-openhands-agent-server";
const OPENHANDS_IMAGE = process.env.OPENHANDS_IMAGE ?? "ghcr.io/openhands/agent-server:1.35.0-python";
const OPENHANDS_DOCKER_PORT = process.env.OPENHANDS_PORT ?? "39009";
const OPENHANDS_VSCODE_PORT = process.env.OPENHANDS_VSCODE_PORT ?? "39017";

const PLANNER_URL = process.env.PLANNER_URL ?? "http://127.0.0.1:39006";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:39007";
const OPENHANDS_URL = process.env.OPENHANDS_URL ?? "http://127.0.0.1:39009";
const PORT = Number(process.env.DASHBOARD_PORT ?? 39016);

// No default plan - the dashboard discovers the latest workflow on its own (see buildStatus),
// and the planner panel just shows "no plan yet" until one is submitted via the New Plan tab.
let currentPlanId = process.env.PLAN_ID ?? "";

const STAGE_NAMES = [
  "intent_interpreter", "concept_generator", "creative_director", "feature_expander",
  "ux_designer", "art_director", "systems_architect", "edge_case_hunter",
  "scope_challenger", "specification_compiler", "plan_critic", "plan_gate",
];

// ---------------------------------------------------------------------------
// Process management (planner/orchestrator api+worker)
// ---------------------------------------------------------------------------

const SERVICE_DEFS = {
  "planner-api": { cwd: PLANNER_DIR, script: "dev:api", envFile: PLANNER_ENV, dirTag: "planner-pipeline", fileTag: "server.ts" },
  "planner-worker": { cwd: PLANNER_DIR, script: "dev:worker", envFile: PLANNER_ENV, dirTag: "planner-pipeline", fileTag: "worker.ts" },
  "orchestrator-api": { cwd: ORCHESTRATOR_DIR, script: "dev:api", envFile: ORCHESTRATOR_ENV, dirTag: "implementation-orchestrator", fileTag: "server.ts" },
  "orchestrator-worker": { cwd: ORCHESTRATOR_DIR, script: "dev:worker", envFile: ORCHESTRATOR_ENV, dirTag: "implementation-orchestrator", fileTag: "worker.ts" },
};

/** @type {Record<string, string[]>} in-memory captured stdout/stderr, best-effort only */
const logs = Object.fromEntries(Object.keys(SERVICE_DEFS).map((k) => [k, []]));

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function appendLog(key, chunk) {
  const arr = logs[key];
  arr.push(chunk.toString());
  if (arr.length > 200) arr.shift();
}

/**
 * The actual long-lived server (tsx-loaded node process) is found directly by matching its
 * command line, rather than trusting a remembered spawn() pid — an intermediate shell layer
 * (`pnpm run ...`, run with shell:true) can exit on its own while this real process keeps
 * running independently, which makes pid-based tracking silently wrong after any dashboard
 * restart.
 */
async function findServicePid(key) {
  const def = SERVICE_DEFS[key];
  if (process.platform === "win32") {
    const script = `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*${def.dirTag}*${def.fileTag}*' } | Select-Object -First 1 -ExpandProperty ProcessId)`;
    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`, { windowsHide: true });
      const trimmed = stdout.trim();
      return trimmed ? Number(trimmed) : null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execAsync("ps -eo pid=,args=");
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) continue;
      const args = trimmed.slice(spaceIdx + 1);
      if (args.includes(def.dirTag) && args.includes(def.fileTag)) {
        return Number(trimmed.slice(0, spaceIdx));
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function startService(key) {
  if (await findServicePid(key)) return { ok: true, alreadyRunning: true };
  const def = SERVICE_DEFS[key];
  const envText = await readFile(def.envFile, "utf8").catch(() => "");
  const envVars = parseEnvFile(envText);
  const child = spawn(`pnpm run ${def.script}`, {
    cwd: def.cwd,
    env: { ...process.env, ...envVars },
    shell: true,
    windowsHide: true,
  });
  child.stdout?.on("data", (c) => appendLog(key, c));
  child.stderr?.on("data", (c) => appendLog(key, c));
  return { ok: true, pid: child.pid };
}

async function stopService(key) {
  const pid = await findServicePid(key);
  if (!pid) return { ok: true, wasRunning: false };
  if (process.platform === "win32") {
    await execAsync(`taskkill /PID ${pid} /T /F`).catch(() => {});
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  return { ok: true, wasRunning: true };
}

// ---------------------------------------------------------------------------
// OpenHands docker container management
// ---------------------------------------------------------------------------

async function openHandsStatus() {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${OPENHANDS_CONTAINER}`);
    return stdout.trim() === "true" ? "running" : "stopped";
  } catch {
    return "missing";
  }
}

async function startOpenHands() {
  const status = await openHandsStatus();
  if (status === "running") return { ok: true, alreadyRunning: true };
  if (status === "stopped") {
    await execAsync(`docker start ${OPENHANDS_CONTAINER}`);
    return { ok: true, started: "existing" };
  }
  const envText = await readFile(ORCHESTRATOR_ENV, "utf8").catch(() => "");
  const env = parseEnvFile(envText);
  const sessionKey = env.OPENHANDS_SESSION_API_KEY ?? "";
  const cmd = [
    "docker run -d",
    `--name ${OPENHANDS_CONTAINER}`,
    `-p ${OPENHANDS_DOCKER_PORT}:8000 -p ${OPENHANDS_VSCODE_PORT}:8001`,
    `-e OH_SESSION_API_KEYS_0=${sessionKey}`,
    "-e OH_CONVERSATIONS_PATH=/workspace/conversations",
    "-e OH_BASH_EVENTS_DIR=/workspace/bash_events",
    "-e LOG_JSON=true",
    "-e PYTHONUNBUFFERED=1",
    `-v ${WORKSPACE_MOUNT}:/workspace/repos`,
    `${OPENHANDS_IMAGE} --port 8000`,
  ].join(" ");
  await execAsync(cmd);
  return { ok: true, started: "fresh" };
}

async function stopOpenHands() {
  const status = await openHandsStatus();
  if (status !== "running") return { ok: true, wasRunning: false };
  await execAsync(`docker stop ${OPENHANDS_CONTAINER}`);
  return { ok: true, wasRunning: true };
}

// ---------------------------------------------------------------------------
// Status aggregation
// ---------------------------------------------------------------------------

async function getJson(url, options) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...options });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  }
}

async function getOpenHandsSessionKey() {
  const envText = await readFile(ORCHESTRATOR_ENV, "utf8").catch(() => "");
  return parseEnvFile(envText).OPENHANDS_SESSION_API_KEY ?? "";
}

async function getJsonAuthed(url) {
  const key = await getOpenHandsSessionKey();
  return getJson(url, { headers: key ? { "X-Session-API-Key": key } : {} });
}

async function buildStatus() {
  const [plannerRes, workflowsRes, ohHealth, ohRunning] = await Promise.all([
    currentPlanId ? getJson(`${PLANNER_URL}/v1/plans/${currentPlanId}`) : Promise.resolve({ ok: false, none: true }),
    getJson(`${ORCHESTRATOR_URL}/v1/workflows`),
    getJson(`${OPENHANDS_URL}/health`),
    openHandsStatus(),
  ]);

  let workflow = null;
  let tasks = [];
  if (workflowsRes.ok && Array.isArray(workflowsRes.body) && workflowsRes.body.length > 0) {
    const latest = workflowsRes.body[workflowsRes.body.length - 1];
    const [wfRes, tasksRes] = await Promise.all([
      getJson(`${ORCHESTRATOR_URL}/v1/workflows/${latest.workflowId}`),
      getJson(`${ORCHESTRATOR_URL}/v1/workflows/${latest.workflowId}/tasks`),
    ]);
    workflow = wfRes.ok ? wfRes.body : { error: wfRes.error ?? wfRes.body };
    tasks = tasksRes.ok && Array.isArray(tasksRes.body) ? tasksRes.body : [];
  }

  const serviceKeys = Object.keys(SERVICE_DEFS);
  const servicePids = await Promise.all(serviceKeys.map((k) => findServicePid(k)));
  const services = Object.fromEntries(serviceKeys.map((k, i) => [k, servicePids[i] ? "running" : "stopped"]));
  services.openhands = ohRunning;

  return {
    now: new Date().toISOString(),
    currentPlanId,
    services,
    planner: plannerRes.ok
      ? plannerRes.body
      : plannerRes.none
        ? { none: true }
        : { error: plannerRes.error ?? plannerRes.body ?? "unreachable" },
    orchestrator: { workflow, tasks },
    openhands: { healthy: ohHealth.ok, detail: ohHealth.body ?? ohHealth.error },
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/status") {
      return sendJson(res, 200, await buildStatus());
    }

    if (url.pathname === "/api/services/start-all" && req.method === "POST") {
      await Promise.all([
        startService("planner-api"),
        startService("planner-worker"),
        startService("orchestrator-api"),
        startService("orchestrator-worker"),
        startOpenHands(),
      ]);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/services/stop-all" && req.method === "POST") {
      await Promise.all([
        stopService("planner-api"),
        stopService("planner-worker"),
        stopService("orchestrator-api"),
        stopService("orchestrator-worker"),
        stopOpenHands(),
      ]);
      return sendJson(res, 200, { ok: true });
    }

    const serviceMatch = url.pathname.match(/^\/api\/services\/([\w-]+)\/(start|stop)$/);
    if (serviceMatch && req.method === "POST") {
      const [, key, action] = serviceMatch;
      if (key === "openhands") {
        const result = action === "start" ? await startOpenHands() : await stopOpenHands();
        return sendJson(res, 200, result);
      }
      if (SERVICE_DEFS[key]) {
        const result = action === "start" ? await startService(key) : await stopService(key);
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: "unknown_service" });
    }

    const configMatch = url.pathname.match(/^\/api\/config\/(planner|orchestrator)$/);
    if (configMatch && req.method === "GET") {
      const envFile = configMatch[1] === "planner" ? PLANNER_ENV : ORCHESTRATOR_ENV;
      const content = await readFile(envFile, "utf8").catch(() => "");
      return sendJson(res, 200, { content });
    }
    if (configMatch && req.method === "POST") {
      const envFile = configMatch[1] === "planner" ? PLANNER_ENV : ORCHESTRATOR_ENV;
      const body = JSON.parse(await readBody(req));
      await writeFile(envFile, body.content, "utf8");
      if (body.restart) {
        const prefix = configMatch[1];
        await stopService(`${prefix}-api`);
        await stopService(`${prefix}-worker`);
        await startService(`${prefix}-api`);
        await startService(`${prefix}-worker`);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/plans" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await getJson(`${PLANNER_URL}/v1/plans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (result.ok && result.body?.planId) {
        currentPlanId = result.body.planId;
      }
      return sendJson(res, result.ok ? 200 : 400, result.body ?? { error: result.error });
    }

    const planActionMatch = url.pathname.match(/^\/api\/plans\/([\w-]+)\/(retry|pause|resume)$/);
    if (planActionMatch && req.method === "POST") {
      const [, planId, action] = planActionMatch;
      const result = await getJson(`${PLANNER_URL}/v1/plans/${planId}/${action}`, { method: "POST" });
      return sendJson(res, result.ok ? 200 : 400, result.body ?? { error: result.error });
    }

    if (url.pathname === "/api/planner-stages" && req.method === "GET") {
      const results = await Promise.all(
        STAGE_NAMES.map((name) => getJson(`${PLANNER_URL}/v1/plans/${currentPlanId}/stages/${name}`)),
      );
      const stages = results
        .map((r, i) => (r.ok && r.body ? r.body : null))
        .filter(Boolean)
        .map((s) => ({ ...s, name: s.stageName }));
      return sendJson(res, 200, { stages });
    }

    if (url.pathname === "/api/openhands/conversations" && req.method === "GET") {
      const result = await getJsonAuthed(`${OPENHANDS_URL}/api/conversations/search?limit=20&sort_order=CREATED_AT_DESC`);
      return sendJson(res, result.ok ? 200 : 502, result.body ?? { error: result.error });
    }

    const ohEventsMatch = url.pathname.match(/^\/api\/openhands\/conversations\/([\w-]+)\/events$/);
    if (ohEventsMatch && req.method === "GET") {
      const conversationId = ohEventsMatch[1];
      const result = await getJsonAuthed(
        `${OPENHANDS_URL}/api/conversations/${conversationId}/events/search?limit=100&sort_order=TIMESTAMP`,
      );
      return sendJson(res, result.ok ? 200 : 502, result.body ?? { error: result.error });
    }

    if (ohEventsMatch && req.method === "POST") {
      const conversationId = ohEventsMatch[1];
      const body = JSON.parse(await readBody(req));
      const key = await getOpenHandsSessionKey();
      const result = await getJson(`${OPENHANDS_URL}/api/conversations/${conversationId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "X-Session-API-Key": key } : {}) },
        body: JSON.stringify({
          role: "user",
          content: [{ type: "text", text: body.text }],
          run: true,
        }),
      });
      return sendJson(res, result.ok ? 200 : 502, result.body ?? { error: result.error });
    }

    if (url.pathname === "/api/openhands-vscode-url" && req.method === "GET") {
      const envText = await readFile(ORCHESTRATOR_ENV, "utf8").catch(() => "");
      const token = parseEnvFile(envText).OPENHANDS_SESSION_API_KEY ?? "";
      const requestHost = (req.headers.host ?? "localhost").split(":")[0];
      return sendJson(res, 200, { url: `http://${requestHost}:${OPENHANDS_VSCODE_PORT}/?tkn=${encodeURIComponent(token)}` });
    }

    if (url.pathname === "/api/logs" && req.method === "GET") {
      const key = url.searchParams.get("service");
      const arr = logs[key];
      return sendJson(res, 200, { log: arr && arr.length ? arr.join("") : "(no captured log for this process — only output from processes started via this dashboard is captured)" });
    }

    res.writeHead(200, { "content-type": "text/html" });
    res.end(HTML);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Pipeline Control</title>
<style>
  :root {
    --bg: #0b0d12; --panel: #141824; --border: #262c3d; --text: #e5e9f0; --muted: #8b93a7;
    --accent: #5b8cff; --good: #3ecf8e; --warn: #f2b84b; --bad: #ef5b5b; --running: #5b8cff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
    background: var(--bg); color: var(--text); padding: 24px; max-width: 1200px; margin: 0 auto;
  }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 0 0 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; gap: 8px; }
  .row .label { color: var(--muted); }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.completed, .badge.accepted, .badge.healthy, .badge.running { background: rgba(62,207,142,0.15); color: var(--good); }
  .badge.failed, .badge.cancelled, .badge.unreachable, .badge.stopped, .badge.missing { background: rgba(239,91,91,0.15); color: var(--bad); }
  .badge.queued, .badge.leased, .badge.verifying, .badge.builder_completed { background: rgba(91,140,255,0.15); color: var(--running); }
  .badge.pending, .badge.blocked, .badge.ready, .badge.retry_scheduled, .badge.remediation_required, .badge.verification_failed, .badge.paused { background: rgba(242,184,75,0.15); color: var(--warn); }
  .bar-track { height: 8px; background: #1e2333; border-radius: 999px; overflow: hidden; margin: 6px 0 14px; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--good)); transition: width 0.4s ease; }
  .stages { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .stage-chip { font-size: 11px; padding: 3px 8px; border-radius: 6px; background: #1c2233; color: var(--muted); }
  .stage-chip.done { color: var(--good); background: rgba(62,207,142,0.1); }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .footer { color: var(--muted); font-size: 12px; margin-top: 20px; text-align: center; }
  .error-box { color: var(--bad); font-size: 12.5px; background: rgba(239,91,91,0.08); padding: 8px 10px; border-radius: 6px; margin-top: 8px; white-space: pre-wrap; }
  .empty { color: var(--muted); font-size: 13px; font-style: italic; }
  button {
    background: #1c2233; color: var(--text); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; font-size: 12.5px; cursor: pointer;
  }
  button:hover { background: #232a3f; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.1); }
  button.danger { background: rgba(239,91,91,0.15); border-color: var(--bad); color: var(--bad); }
  .service-list { display: flex; flex-direction: column; gap: 8px; }
  .service-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #10131c; border-radius: 6px; }
  .service-item .name { font-size: 13px; }
  .service-item .controls { display: flex; gap: 6px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 14px; }
  textarea {
    width: 100%; min-height: 220px; background: #10131c; color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 10px; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; resize: vertical;
  }
  input, textarea.short { background: #10131c; color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12.5px; }
  input[type="text"], input[type="number"], textarea.field { width: 100%; }
  .field-group { margin-bottom: 10px; }
  .field-group label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .field-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
  iframe.embed { width: 100%; height: 480px; border: 1px solid var(--border); border-radius: 8px; background: #000; }
  iframe.embed.tall { height: 78vh; }
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; }
  .tabs button { flex: none; }
  .tabs button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .main-tabs { display: flex; gap: 6px; margin-bottom: 18px; border-bottom: 1px solid var(--border); padding-bottom: 12px; flex-wrap: wrap; }
  .main-tabs button { flex: none; padding: 8px 14px; font-size: 13px; }
  .main-tabs button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .stage-card { background: #10131c; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .stage-card .stage-head { display: flex; justify-content: space-between; align-items: center; }
  .stage-card .stage-name { font-size: 13.5px; font-weight: 600; }
  .stage-card pre { max-height: 400px; overflow: auto; background: #0b0d12; padding: 10px; border-radius: 6px; font-size: 11.5px; margin: 8px 0 0; }
  .stage-card .stage-meta { color: var(--muted); font-size: 11.5px; margin-top: 4px; }
  .stage-card.in-progress { border-color: var(--accent); }
  .chat-log { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto; padding: 4px; }
  .chat-msg { border-radius: 8px; padding: 10px 12px; font-size: 13px; max-width: 90%; }
  .chat-msg.user { background: rgba(91,140,255,0.12); align-self: flex-end; }
  .chat-msg.agent { background: #10131c; border: 1px solid var(--border); align-self: flex-start; }
  .chat-msg.tool { background: rgba(242,184,75,0.08); border: 1px solid var(--border); align-self: flex-start; font-family: ui-monospace, monospace; font-size: 11.5px; }
  .chat-msg.error { background: rgba(239,91,91,0.1); border: 1px solid var(--bad); align-self: flex-start; }
  .chat-msg.system { background: transparent; color: var(--muted); font-style: italic; font-size: 11.5px; align-self: center; }
  .chat-msg .chat-meta { color: var(--muted); font-size: 10.5px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
  .chat-msg pre { white-space: pre-wrap; word-break: break-word; margin: 4px 0 0; font-size: 11.5px; }
  .chat-input-row { display: flex; gap: 8px; margin-top: 12px; }
  .chat-input-row input { flex: 1; }
  select { background: #10131c; color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12.5px; }
</style>
</head>
<body>
  <h1>Pipeline Control</h1>
  <div class="subtitle" id="updated">loading...</div>

  <div class="main-tabs">
    <button id="maintab-overview" class="active" onclick="switchMainTab('overview')">Overview</button>
    <button id="maintab-planner-live" onclick="switchMainTab('planner-live')">Planner Live</button>
    <button id="maintab-newplan" onclick="switchMainTab('newplan')">New Plan</button>
    <button id="maintab-config" onclick="switchMainTab('config')">Configuration</button>
    <button id="maintab-openhands" onclick="switchMainTab('openhands')">OpenHands IDE</button>
    <button id="maintab-ohchat" onclick="switchMainTab('ohchat')">OpenHands Chat</button>
  </div>

  <div class="tab-content active" id="tab-overview">
    <div class="panel">
      <h2>Services</h2>
      <div class="toolbar">
        <button class="primary" onclick="controlAll('start-all')">Start All</button>
        <button class="danger" onclick="controlAll('stop-all')">Stop All</button>
      </div>
      <div class="service-list" id="service-list"></div>
    </div>

    <div class="grid">
      <div class="panel" id="planner-panel"><h2>Planner</h2><div class="empty">loading...</div></div>
      <div class="panel" id="orchestrator-panel"><h2>Orchestrator</h2><div class="empty">loading...</div></div>
    </div>

    <div class="panel" id="tasks-panel"><h2>Tasks</h2><div class="empty">loading...</div></div>
  </div>

  <div class="tab-content" id="tab-planner-live">
    <div class="panel">
      <h2>Planner Live — stage-by-stage output</h2>
      <div class="empty" style="margin-bottom:10px;">The planner doesn't stream tokens, so this shows each stage's actual structured output as soon as it completes.</div>
      <div id="planner-stages"></div>
    </div>
  </div>

  <div class="tab-content" id="tab-newplan">
    <div class="panel">
      <h2>New Plan Request</h2>
      <div class="field-group"><label>Title</label><input type="text" id="np-title" placeholder="e.g. Task tracker web app" /></div>
      <div class="field-group"><label>Brief</label><textarea class="field" id="np-brief" placeholder="Describe what to build..."></textarea></div>
      <div class="field-group"><label>Constraints (one per line)</label><textarea class="field" id="np-constraints" style="min-height:80px"></textarea></div>
      <div class="field-row">
        <div class="field-group"><label>Strictness (1-10)</label><input type="number" id="np-strictness" value="8" min="1" max="10" /></div>
        <div class="field-group"><label>Creativity (1-10)</label><input type="number" id="np-creativity" value="7" min="1" max="10" /></div>
        <div class="field-group"><label>Detail level (1-10)</label><input type="number" id="np-detail" value="9" min="1" max="10" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Target quality score</label><input type="number" id="np-quality" value="88" min="1" max="100" /></div>
        <div class="field-group"><label>Max revision cycles</label><input type="number" id="np-revisions" value="4" min="0" max="10" /></div>
        <div class="field-group"><label>Existing stack (one per line)</label><textarea class="field" id="np-stack" style="min-height:40px"></textarea></div>
      </div>
      <h2 style="margin-top:18px;">Implementation Target (optional)</h2>
      <div class="empty" style="margin-bottom:8px;">Leave repository URL blank for a planning-only run. Fill it in if this plan should be published to implementation-orchestrator once it passes — there's no way to attach a target after the plan is created.</div>
      <div class="field-row">
        <div class="field-group"><label>Repository URL</label><input type="text" id="np-repo-url" placeholder="e.g. /path/to/your-repo" /></div>
        <div class="field-group"><label>Base branch</label><input type="text" id="np-repo-branch" value="main" /></div>
        <div class="field-group"><label>Credential reference (optional)</label><input type="text" id="np-repo-cred" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Policy profile</label><input type="text" id="np-policy-profile" value="default-safe" /></div>
        <div class="field-group"><label>Builder profile</label><input type="text" id="np-builder-profile" value="mock" /></div>
      </div>
      <button class="primary" onclick="submitPlan()">Submit Plan Request</button>
      <span id="np-result" style="margin-left:10px; font-size:12.5px; color: var(--muted);"></span>
    </div>
  </div>

  <div class="tab-content" id="tab-config">
    <div class="panel">
      <h2>Configuration</h2>
      <div class="tabs">
        <button id="cfg-tab-planner" class="active" onclick="switchConfigTab('planner')">Planner .env</button>
        <button id="cfg-tab-orchestrator" onclick="switchConfigTab('orchestrator')">Orchestrator .env</button>
      </div>
      <textarea id="cfg-textarea"></textarea>
      <div class="toolbar" style="margin-top:10px;">
        <button class="primary" onclick="saveConfig(false)">Save</button>
        <button onclick="saveConfig(true)">Save &amp; Restart</button>
      </div>
    </div>
  </div>

  <div class="tab-content" id="tab-openhands">
    <div class="panel">
      <h2>OpenHands Web IDE</h2>
      <div class="empty" style="margin-bottom:8px;">This is the VSCode server bundled in the OpenHands agent-server container, pointed at the workspace it's operating on. If it doesn't load, the container may still be starting up.</div>
      <iframe class="embed tall" id="oh-iframe" src="about:blank"></iframe>
      <div style="margin-top:6px;"><a href="#" id="oh-link" target="_blank" style="color:var(--accent); font-size:12.5px;">Open in new tab</a></div>
    </div>
  </div>

  <div class="tab-content" id="tab-ohchat">
    <div class="panel">
      <h2>OpenHands Chat — live conversation</h2>
      <div class="empty" style="margin-bottom:10px;">Real events from the running agent conversation (messages, tool calls, tool results). You can also send it a message directly.</div>
      <div class="field-group">
        <label>Conversation</label>
        <select id="oh-conv-select" onchange="onConversationChange()"></select>
      </div>
      <div class="chat-log" id="oh-chat-log"><div class="empty">No conversation selected yet</div></div>
      <div class="chat-input-row">
        <input type="text" id="oh-chat-input" placeholder="Send a message to the agent..." onkeydown="if(event.key==='Enter') sendOpenHandsMessage()" />
        <button class="primary" onclick="sendOpenHandsMessage()">Send</button>
      </div>
    </div>
  </div>

  <div class="footer">Auto-refreshing every 3s</div>

<script>
let configTab = "planner";

function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(status) + '</span>'; }
function fmtAge(iso) {
  if (!iso) return "-";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

const SERVICE_LABELS = {
  "planner-api": "Planner API",
  "planner-worker": "Planner Worker",
  "orchestrator-api": "Orchestrator API",
  "orchestrator-worker": "Orchestrator Worker",
  "openhands": "OpenHands Agent Server",
};

function renderServices(services) {
  const el = document.getElementById("service-list");
  el.innerHTML = Object.entries(services).map(([key, status]) => \`
    <div class="service-item">
      <span class="name">\${SERVICE_LABELS[key] ?? key}</span>
      <span>\${badge(status)}</span>
      <span class="controls">
        <button onclick="controlOne('\${key}', 'start')">Start</button>
        <button onclick="controlOne('\${key}', 'stop')">Stop</button>
      </span>
    </div>
  \`).join("");
}

async function controlAll(action) {
  await fetch("/api/services/" + action, { method: "POST" });
  tick();
}
async function controlOne(key, action) {
  await fetch("/api/services/" + key + "/" + action, { method: "POST" });
  tick();
}

function renderPlanner(p) {
  const el = document.getElementById("planner-panel");
  if (p.none) {
    el.innerHTML = '<h2>Planner</h2><div class="empty">No plan yet — submit one via the New Plan tab</div>';
    return;
  }
  if (p.error) {
    el.innerHTML = '<h2>Planner</h2><div class="error-box">' + esc(JSON.stringify(p.error)) + '</div>';
    return;
  }
  const stageOrder = ["intent_interpreter","concept_generator","creative_director","feature_expander","ux_designer","art_director","systems_architect","edge_case_hunter","scope_challenger","specification_compiler","plan_critic","plan_gate"];
  const completed = new Set(p.completedStages ?? []);
  const chips = stageOrder.map((s) => '<span class="stage-chip ' + (completed.has(s) ? "done" : "") + '">' + s + '</span>').join("");
  el.innerHTML = \`
    <h2>Planner</h2>
    <div class="row"><span class="label">Plan</span><span>\${esc(p.title)}</span></div>
    <div class="row"><span class="label">Status</span>\${badge(p.status)}</div>
    <div class="row"><span class="label">Stage</span><span>\${esc(p.currentStage ?? "-")}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:\${p.progressPercentage ?? 0}%"></div></div>
    <div class="row"><span class="label">Revision cycle</span><span>\${p.revisionCycle}/\${p.maxRevisionCycles}</span></div>
    <div class="row"><span class="label">Quality score</span><span>\${p.latestQualityScore ?? "-"}</span></div>
    <div class="stages">\${chips}</div>
    \${p.failure ? '<div class="error-box">' + esc(p.failure.code) + ": " + esc(p.failure.message).slice(0, 500) + '</div><button onclick="retryPlan()">Retry</button>' : ""}
    \${p.status === "paused" ? '<button onclick="resumePlan()">Resume</button>' : ""}
    \${(p.status === "running" || p.status === "queued") ? '<button onclick="pausePlan()">Pause</button>' : ""}
  \`;
}

async function retryPlan() {
  const status = await (await fetch("/api/status")).json();
  await fetch("/api/plans/" + status.currentPlanId + "/retry", { method: "POST" });
  tick();
}

async function pausePlan() {
  const status = await (await fetch("/api/status")).json();
  // Only flips the DB status - whatever stage is already generating runs to its normal
  // completion or failure, it just won't start the next one. Safe to hit any time.
  await fetch("/api/plans/" + status.currentPlanId + "/pause", { method: "POST" });
  tick();
}

async function resumePlan() {
  const status = await (await fetch("/api/status")).json();
  await fetch("/api/plans/" + status.currentPlanId + "/resume", { method: "POST" });
  tick();
}

function renderOrchestrator(o) {
  const el = document.getElementById("orchestrator-panel");
  const wf = o.workflow;
  if (!wf) {
    el.innerHTML = '<h2>Orchestrator</h2><div class="empty">No workflow created yet</div>';
    return;
  }
  if (wf.error) {
    el.innerHTML = '<h2>Orchestrator</h2><div class="error-box">' + esc(JSON.stringify(wf.error)) + '</div>';
    return;
  }
  const totals = wf.taskTotals ?? {};
  const totalsHtml = Object.entries(totals).filter(([,v]) => v).map(([k,v]) => badge(k) + ' &times;' + v).join(" &nbsp; ") || '<span class="empty">no tasks yet</span>';
  el.innerHTML = \`
    <h2>Orchestrator</h2>
    <div class="row"><span class="label">Workflow</span><span>\${esc(wf.name)}</span></div>
    <div class="row"><span class="label">Status</span>\${badge(wf.status)}</div>
    <div class="row"><span class="label">Active leases</span><span>\${wf.activeLeases}</span></div>
    <div class="row"><span class="label">Retry count</span><span>\${wf.retryCount}</span></div>
    <div class="row"><span class="label">Tasks</span><span>\${totalsHtml}</span></div>
    \${wf.failureDetails ? '<div class="error-box">' + esc(wf.failureDetails.failureCode) + " (" + esc(wf.failureDetails.failureClass) + ") at " + esc(wf.failureDetails.stage ?? "-") + (wf.failureDetails.suggestedOperatorAction ? "\\n-> " + esc(wf.failureDetails.suggestedOperatorAction) : "") + '</div>' : ""}
    \${wf.completionSummary ? '<div class="row" style="color:var(--good)">COMPLETE: accepted=' + wf.completionSummary.acceptedTasks + ' skippedOptional=' + wf.completionSummary.skippedOptionalTasks + ' failedOptional=' + wf.completionSummary.failedOptionalTasks + '</div>' : ""}
  \`;
}

function renderTasks(tasks) {
  const el = document.getElementById("tasks-panel");
  if (!tasks || tasks.length === 0) {
    el.innerHTML = '<h2>Tasks</h2><div class="empty">No tasks compiled yet</div>';
    return;
  }
  const rows = tasks.map((t) => \`
    <tr>
      <td>\${esc(t.title)}</td>
      <td>\${badge(t.status)}</td>
      <td>\${esc(t.category)}</td>
      <td>\${esc(t.priority)}</td>
      <td>\${fmtAge(t.updatedAt)}</td>
    </tr>
  \`).join("");
  el.innerHTML = \`
    <h2>Tasks (\${tasks.length})</h2>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th>Category</th><th>Priority</th><th>Updated</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table>
  \`;
}

const MAIN_TABS = ["overview", "planner-live", "newplan", "config", "openhands", "ohchat"];
function switchMainTab(tab) {
  for (const t of MAIN_TABS) {
    document.getElementById("maintab-" + t).classList.toggle("active", t === tab);
    document.getElementById("tab-" + t).classList.toggle("active", t === tab);
  }
}

let lastPlannerStagesJson = null;

function renderPlannerStages(stages) {
  const json = JSON.stringify(stages);
  if (json === lastPlannerStagesJson) return; // nothing changed - don't disturb open <details> or scroll position
  lastPlannerStagesJson = json;

  const el = document.getElementById("planner-stages");
  const openNames = new Set(
    Array.from(el.querySelectorAll("details[open]")).map((d) => d.closest(".stage-card")?.dataset.name),
  );
  const scrollY = window.scrollY;

  if (!stages || stages.length === 0) {
    el.innerHTML = '<div class="empty">No stages completed yet</div>';
    return;
  }
  el.innerHTML = stages.map((s) => {
    const itemCounts = s.summary?.itemCounts ? Object.entries(s.summary.itemCounts).map(([k,v]) => k + '=' + v).join(", ") : "";
    const open = openNames.has(s.name) ? " open" : "";
    return \`
      <div class="stage-card" data-name="\${esc(s.name)}">
        <div class="stage-head">
          <span class="stage-name">\${esc(s.name)}</span>
          \${badge(s.status)}
        </div>
        <div class="stage-meta">attempt \${s.attempt} \${s.completedAt ? "· completed " + fmtAge(s.completedAt) : ""} \${itemCounts ? "· " + esc(itemCounts) : ""}</div>
        \${s.summary?.headline ? '<div class="stage-meta">' + esc(s.summary.headline) + '</div>' : ""}
        <details\${open}>
          <summary>View structured output</summary>
          <pre>\${esc(JSON.stringify(s.output ?? s.summary ?? {}, null, 2))}</pre>
        </details>
      </div>
    \`;
  }).join("");
  window.scrollTo(0, scrollY);
}

async function tickPlannerStages() {
  try {
    const res = await fetch("/api/planner-stages");
    const data = await res.json();
    renderPlannerStages(data.stages);
  } catch (e) {
    document.getElementById("planner-stages").innerHTML = '<div class="error-box">' + esc(e.message) + '</div>';
  }
}

async function tick() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    document.getElementById("updated").textContent = "Last updated: " + new Date(data.now).toLocaleTimeString() + " | plan: " + data.currentPlanId;
    renderServices(data.services);
    renderPlanner(data.planner);
    renderOrchestrator(data.orchestrator);
    renderTasks(data.orchestrator.tasks);
  } catch (e) {
    document.getElementById("updated").textContent = "Error fetching status: " + e.message;
  }
}
tick();
setInterval(tick, 5000);
tickPlannerStages();
setInterval(tickPlannerStages, 10000);

(async function loadOpenHandsUrl() {
  try {
    const res = await fetch("/api/openhands-vscode-url");
    const { url } = await res.json();
    document.getElementById("oh-iframe").src = url;
    document.getElementById("oh-link").href = url;
  } catch {}
})();

async function submitPlan() {
  const constraints = document.getElementById("np-constraints").value.split("\\n").map((s) => s.trim()).filter(Boolean);
  const stack = document.getElementById("np-stack").value.split("\\n").map((s) => s.trim()).filter(Boolean);
  const payload = {
    title: document.getElementById("np-title").value,
    brief: document.getElementById("np-brief").value,
    constraints,
    preferences: {
      strictness: Number(document.getElementById("np-strictness").value),
      creativity: Number(document.getElementById("np-creativity").value),
      detailLevel: Number(document.getElementById("np-detail").value),
      targetQualityScore: Number(document.getElementById("np-quality").value),
      maxRevisionCycles: Number(document.getElementById("np-revisions").value),
    },
    context: { existingStack: stack, existingSystems: [], referenceNotes: [] },
  };
  const repoUrl = document.getElementById("np-repo-url").value.trim();
  if (repoUrl) {
    const credentialReference = document.getElementById("np-repo-cred").value.trim();
    payload.implementationTarget = {
      repository: {
        url: repoUrl,
        baseBranch: document.getElementById("np-repo-branch").value.trim() || "main",
        ...(credentialReference ? { credentialReference } : {}),
      },
      policyProfile: document.getElementById("np-policy-profile").value.trim() || "default-safe",
      builderProfile: document.getElementById("np-builder-profile").value.trim() || "mock",
    };
  }
  const res = await fetch("/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  document.getElementById("np-result").textContent = res.ok ? "Submitted: " + body.planId : "Error: " + JSON.stringify(body);
  tick();
}

async function switchConfigTab(tab) {
  configTab = tab;
  document.getElementById("cfg-tab-planner").classList.toggle("active", tab === "planner");
  document.getElementById("cfg-tab-orchestrator").classList.toggle("active", tab === "orchestrator");
  const res = await fetch("/api/config/" + tab);
  const data = await res.json();
  document.getElementById("cfg-textarea").value = data.content;
}
switchConfigTab("planner");

async function saveConfig(restart) {
  const content = document.getElementById("cfg-textarea").value;
  await fetch("/api/config/" + configTab, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, restart }),
  });
  tick();
}

// ---------------------------------------------------------------------------
// OpenHands chat
// ---------------------------------------------------------------------------

let selectedConversationId = null;
let conversationListLoaded = false;

function extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : c.text ?? JSON.stringify(c))).join("\\n");
  }
  if (content.text) return content.text;
  return JSON.stringify(content);
}

function renderEvent(ev) {
  const kind = ev.kind ?? "";
  const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "";
  if (kind === "MessageEvent") {
    const role = ev.source === "user" ? "user" : "agent";
    return \`<div class="chat-msg \${role}"><div class="chat-meta">\${esc(ev.source)} · \${time}</div><pre>\${esc(extractText(ev.llm_message?.content ?? ev.llm_message))}</pre></div>\`;
  }
  if (kind === "ActionEvent") {
    const thought = ev.thought ? extractText(ev.thought) : "";
    return \`<div class="chat-msg tool"><div class="chat-meta">action: \${esc(ev.tool_name ?? "?")} · \${time}</div>\${thought ? '<div style="font-style:italic;color:var(--muted);margin-bottom:4px;">' + esc(thought) + '</div>' : ""}<pre>\${esc(JSON.stringify(ev.action ?? {}, null, 2)).slice(0, 2000)}</pre></div>\`;
  }
  if (kind === "ObservationEvent") {
    return \`<div class="chat-msg tool"><div class="chat-meta">result: \${esc(ev.tool_name ?? "?")} · \${time}</div><pre>\${esc(JSON.stringify(ev.observation ?? {}, null, 2)).slice(0, 2000)}</pre></div>\`;
  }
  if (kind === "AgentErrorEvent") {
    return \`<div class="chat-msg error"><div class="chat-meta">error · \${time}</div><pre>\${esc(extractText(ev.error))}</pre></div>\`;
  }
  if (kind === "SystemPromptEvent") {
    return \`<div class="chat-msg system">system prompt set · \${time}</div>\`;
  }
  return \`<div class="chat-msg system">\${esc(kind)} · \${time}</div>\`;
}

async function loadConversations() {
  try {
    const res = await fetch("/api/openhands/conversations");
    const data = await res.json();
    const items = data.items ?? data.conversations ?? (Array.isArray(data) ? data : []);
    const select = document.getElementById("oh-conv-select");
    const prev = select.value;
    select.innerHTML = items.map((c) => {
      const id = c.id ?? c.conversation_id;
      const label = (c.title || id) + " (" + (c.execution_status ?? c.status ?? "?") + ")";
      return '<option value="' + esc(id) + '">' + esc(label) + '</option>';
    }).join("");
    if (items.length > 0) {
      if (prev && items.some((c) => (c.id ?? c.conversation_id) === prev)) {
        select.value = prev;
      } else if (!conversationListLoaded) {
        select.value = items[0].id ?? items[0].conversation_id;
      }
      selectedConversationId = select.value;
    }
    conversationListLoaded = true;
  } catch (e) {
    // OpenHands may not be reachable yet; ignore quietly on the chat tab.
  }
}

function onConversationChange() {
  selectedConversationId = document.getElementById("oh-conv-select").value;
  tickChat();
}

let lastChatEventsJson = null;

async function tickChat() {
  await loadConversations();
  if (!selectedConversationId) {
    document.getElementById("oh-chat-log").innerHTML = '<div class="empty">No conversation yet — the orchestrator creates one once it dispatches a task to OpenHands.</div>';
    return;
  }
  try {
    const res = await fetch("/api/openhands/conversations/" + selectedConversationId + "/events");
    const data = await res.json();
    const events = data.items ?? data.events ?? (Array.isArray(data) ? data : []);
    const json = JSON.stringify(events);
    if (json === lastChatEventsJson) return; // nothing new - don't disturb scroll/selection
    lastChatEventsJson = json;
    const log = document.getElementById("oh-chat-log");
    const wasAtBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.innerHTML = events.map(renderEvent).join("") || '<div class="empty">No events yet</div>';
    if (wasAtBottom) log.scrollTop = log.scrollHeight;
  } catch (e) {
    document.getElementById("oh-chat-log").innerHTML = '<div class="error-box">' + esc(e.message) + '</div>';
  }
}

async function sendOpenHandsMessage() {
  const input = document.getElementById("oh-chat-input");
  const text = input.value.trim();
  if (!text || !selectedConversationId) return;
  input.value = "";
  await fetch("/api/openhands/conversations/" + selectedConversationId + "/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  tickChat();
}

tickChat();
setInterval(tickChat, 6000);
</script>
</body>
</html>`;

server.listen(PORT, () => {
  console.log(`Pipeline control dashboard running at http://localhost:${PORT}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
