#!/usr/bin/env node
// Terminal dashboard for the planner -> implementation-orchestrator -> OpenHands pipeline.
// Usage: node pipeline-status.mjs [--plan <planId>] [--workflow <workflowId>] [--interval <ms>]

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PLANNER_URL = process.env.PLANNER_URL ?? "http://127.0.0.1:39006";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:39007";
const OPENHANDS_URL = process.env.OPENHANDS_URL ?? "http://127.0.0.1:39009";
const planId = argValue("plan", process.env.PLAN_ID ?? null);
let workflowId = argValue("workflow", process.env.WORKFLOW_ID ?? null);
const interval = Number(argValue("interval", 3000));

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  }
}

function bar(percent, width = 24) {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + `] ${percent}%`;
}

function fmtAge(iso) {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

const TASK_ORDER = [
  "pending", "blocked", "ready", "leased", "running", "builder_completed",
  "verifying", "verification_failed", "remediation_required", "accepted",
  "retry_scheduled", "failed", "cancelled",
];

async function render() {
  const lines = [];
  const now = new Date().toLocaleTimeString();
  lines.push(`Pipeline status  —  ${now}`);
  lines.push("=".repeat(70));

  // Planner
  lines.push("");
  lines.push("PLANNER  " + PLANNER_URL);
  if (!planId) {
    lines.push("  (no --plan given)");
  } else {
    const { ok, body, error } = await getJson(`${PLANNER_URL}/v1/plans/${planId}`);
    if (!ok) {
      lines.push(`  ERROR reaching planner: ${error ?? body?.error ?? "unknown"}`);
    } else {
      lines.push(`  plan:    ${body.planId}`);
      lines.push(`  title:   ${body.title}`);
      lines.push(`  status:  ${body.status}   stage: ${body.currentStage ?? "-"}`);
      lines.push(`  ${bar(body.progressPercentage ?? 0)}`);
      lines.push(`  completed stages: ${(body.completedStages ?? []).join(", ") || "-"}`);
      lines.push(`  revision cycle:   ${body.revisionCycle}/${body.maxRevisionCycles}   quality: ${body.latestQualityScore ?? "-"}`);
      if (body.failure) {
        lines.push(`  FAILURE: ${JSON.stringify(body.failure)}`);
      }
    }
  }

  // Orchestrator
  lines.push("");
  lines.push("ORCHESTRATOR  " + ORCHESTRATOR_URL);
  if (!workflowId) {
    lines.push("  (no --workflow given yet)");
  } else {
    const { ok, body, error } = await getJson(`${ORCHESTRATOR_URL}/v1/workflows/${workflowId}`);
    if (!ok) {
      lines.push(`  ERROR reaching orchestrator: ${error ?? body?.error ?? "unknown"}`);
    } else {
      lines.push(`  workflow: ${body.workflowId}  (${body.name})`);
      lines.push(`  status:   ${body.status}   active leases: ${body.activeLeases}   retries: ${body.retryCount}`);
      const totals = body.taskTotals ?? {};
      const totalsLine = TASK_ORDER.filter((s) => totals[s]).map((s) => `${s}=${totals[s]}`).join("  ");
      lines.push(`  tasks:    ${totalsLine || "(none yet)"}`);
      if (body.latestErrors?.length) {
        lines.push(`  recent errors: ${body.latestErrors.slice(-3).join(" | ")}`);
      }
      if (body.failureDetails) {
        lines.push(`  FAILURE: ${body.failureDetails.failureCode} (${body.failureDetails.failureClass}) at ${body.failureDetails.stage ?? "-"}`);
        if (body.failureDetails.suggestedOperatorAction) {
          lines.push(`    -> ${body.failureDetails.suggestedOperatorAction}`);
        }
      }
      if (body.completionSummary) {
        const c = body.completionSummary;
        lines.push(`  COMPLETE: accepted=${c.acceptedTasks} skippedOptional=${c.skippedOptionalTasks} failedOptional=${c.failedOptionalTasks}`);
        lines.push(`    base=${c.baseCommitSha.slice(0, 8)} final=${c.finalCommitSha.slice(0, 8)}`);
      }

      const tasksRes = await getJson(`${ORCHESTRATOR_URL}/v1/workflows/${workflowId}/tasks`);
      if (tasksRes.ok && Array.isArray(tasksRes.body)) {
        lines.push("");
        lines.push("  " + "TASK".padEnd(28) + "STATUS".padEnd(22) + "CATEGORY".padEnd(14) + "PRI".padEnd(10) + "AGE");
        for (const t of tasksRes.body) {
          lines.push(
            "  " +
              t.title.slice(0, 26).padEnd(28) +
              t.status.padEnd(22) +
              t.category.padEnd(14) +
              t.priority.padEnd(10) +
              fmtAge(t.updatedAt),
          );
        }
      }
    }
  }

  // OpenHands
  lines.push("");
  lines.push("OPENHANDS AGENT SERVER  " + OPENHANDS_URL);
  const oh = await getJson(`${OPENHANDS_URL}/health`);
  lines.push(`  ${oh.ok ? "healthy" : "UNREACHABLE: " + (oh.error ?? oh.status)}`);

  console.clear();
  console.log(lines.join("\n"));
  console.log("");
  console.log(`(refreshing every ${interval}ms — Ctrl+C to exit)`);
}

async function loop() {
  // Auto-discover the latest workflow if none was given and the orchestrator has one.
  if (!workflowId) {
    const { ok, body } = await getJson(`${ORCHESTRATOR_URL}/v1/workflows`);
    if (ok && Array.isArray(body) && body.length > 0) {
      workflowId = body[body.length - 1].workflowId;
    }
  }
  await render();
}

await loop();
setInterval(loop, interval);
