import { escapeHtml as h } from "/plugin-tab-shared.js";

async function callApi(fetchImpl, path = "", options = {}) {
  const r = await fetchImpl(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

const STATUS_TABS = [
  { id: "queued", label: "Queued" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" }
];

function fmtTime(iso = "") {
  const ts = Date.parse(iso || "");
  return Number.isFinite(ts) ? new Date(ts).toLocaleString() : "";
}

function setSubtab(root, id = "queued") {
  root.dataset.queueTab = id;
  root.querySelectorAll("[data-queue-subtab-target]").forEach((b) => b.classList.toggle("active", b.dataset.queueSubtabTarget === id));
  root.querySelectorAll("[data-queue-subtab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.queueSubtabPanel === id));
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  const fetchImpl = context?.pluginAdminFetch || context?.observerApp?.pluginAdminFetch || fetch;
  const api = (path, options) => callApi(fetchImpl, path, options);

  if (!document.getElementById("queuePluginStyles")) {
    const s = document.createElement("style");
    s.id = "queuePluginStyles";
    s.textContent = `
      .queue-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .queue-subtabs button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}
      .queue-subtabs button.active{background:var(--accent);color:#1a0f00;border-color:transparent}
      [data-queue-subtab-panel]{display:none}[data-queue-subtab-panel].active{display:block}
      .queue-list{display:grid;gap:8px}
      .queue-item{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel)}
      .queue-item .micro{color:var(--muted);font-size:0.8em;margin-top:4px}
      .queue-item .req{white-space:pre-wrap;word-break:break-word}
      .queue-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .queue-actions button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
      .queue-compose{display:flex;gap:8px;margin-bottom:14px}
      .queue-compose textarea{flex:1;min-height:44px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--ink);padding:8px;font:inherit;resize:vertical}
      .queue-compose button{border:none;background:var(--accent);color:#1a0f00;border-radius:8px;padding:0 16px;font:inherit;font-weight:700;cursor:pointer}
      .queue-form{display:grid;gap:8px;margin-bottom:14px}
      .queue-form input,.queue-form select{border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--ink);padding:7px 9px;font:inherit}
      .queue-form-row{display:flex;gap:8px;flex-wrap:wrap}
      .queue-form-row > *{flex:1;min-width:140px}
      .tone-bad{color:var(--bad)}
      .tone-ok{color:var(--ok)}
    `;
    document.head.appendChild(s);
  }

  if (!root.dataset.queueMounted) {
    root.innerHTML = `
      <section>
        <div class="panel-head">
          <div><h2>Queue</h2><div class="panel-subtle">Task queue, execution status, and schedules — owned by the agent-runtime plugin.</div></div>
          <button id="queueRefreshBtn" type="button">Refresh</button>
        </div>
        <div id="queueHint" class="panel-subtle">Loading&hellip;</div>

        <div class="queue-compose">
          <textarea id="queueNewRequest" rows="2" placeholder="Describe a new task for the agent to run&hellip;"></textarea>
          <button id="queueNewBtn" type="button">Queue task</button>
        </div>

        <div class="queue-subtabs" role="tablist">
          ${STATUS_TABS.map((t, i) => `<button type="button" class="${i === 0 ? "active" : ""}" data-queue-subtab-target="${t.id}">${h(t.label)}</button>`).join("")}
          <button type="button" data-queue-subtab-target="schedules">Schedules</button>
          <button type="button" data-queue-subtab-target="settings">Settings</button>
        </div>

        ${STATUS_TABS.map((t, i) => `
          <div class="card${i === 0 ? " active" : ""}" data-queue-subtab-panel="${t.id}">
            <div id="queueList_${t.id}" class="queue-list"><div class="panel-subtle">Loading&hellip;</div></div>
          </div>
        `).join("")}

        <div class="card" data-queue-subtab-panel="schedules">
          <div class="queue-form">
            <div class="queue-form-row">
              <input id="cronDirective" placeholder="What should this schedule ask the agent to do?">
            </div>
            <div class="queue-form-row">
              <input id="cronIntervalMinutes" type="number" min="1" value="60" placeholder="Every N minutes">
              <button id="cronAddBtn" type="button">Add schedule</button>
            </div>
          </div>
          <div id="cronList" class="queue-list"><div class="panel-subtle">Loading&hellip;</div></div>
        </div>

        <div class="card" data-queue-subtab-panel="settings">
          <div class="queue-form">
            <label><input id="settingsScanEnabled" type="checkbox"> Enable idle opportunity scan</label>
            <div class="queue-form-row">
              <label>Scan interval (minutes)<input id="settingsScanIntervalMin" type="number" min="1"></label>
              <label>Task retention (days)<input id="settingsRetentionDays" type="number" min="0"></label>
              <label>Max finished tasks kept<input id="settingsMaxFinished" type="number" min="10"></label>
            </div>
            <div><button id="settingsSaveBtn" type="button">Save settings</button></div>
          </div>
        </div>
      </section>
    `;
    root.dataset.queueMounted = "1";
  }

  const hint = root.querySelector("#queueHint");
  const setHint = (text = "", tone = "") => {
    hint.textContent = text;
    hint.className = tone ? `panel-subtle tone-${tone}` : "panel-subtle";
  };

  const renderTaskItem = (task) => {
    const actions = [];
    if (task.status === "in_progress") {
      actions.push(`<button type="button" data-abort="${h(task.id)}">Abort</button>`);
    }
    if (task.status === "waiting") {
      actions.push(`<button type="button" data-answer="${h(task.id)}">Answer</button>`);
    }
    const errorLine = task.error ? `<div class="micro tone-bad">${h(task.error)}</div>` : "";
    const resultLine = task.result?.text ? `<div class="micro">${h(task.result.text.slice(0, 240))}</div>` : "";
    const waitingLine = task.waitingForUser && task.questionForUser ? `<div class="micro">Asking: ${h(task.questionForUser)}</div>` : "";
    return `
      <article class="queue-item" data-task-id="${h(task.id)}">
        <div class="req">${h(task.request || "")}</div>
        <div class="micro">${h(task.id)} &middot; created ${h(fmtTime(task.createdAt))}${task.brainId ? ` &middot; brain: ${h(task.brainId)}` : ""}${task.retryCount ? ` &middot; retry ${task.retryCount}` : ""}</div>
        ${waitingLine}${resultLine}${errorLine}
        ${actions.length ? `<div class="queue-actions">${actions.join("")}</div>` : ""}
      </article>
    `;
  };

  const loadTasks = async () => {
    const { tasks } = await api("/api/tasks");
    const all = Array.isArray(tasks) ? tasks : [];
    for (const tab of STATUS_TABS) {
      const list = root.querySelector(`#queueList_${tab.id}`);
      const matching = all.filter((t) => t.status === tab.id).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      list.innerHTML = matching.length ? matching.map(renderTaskItem).join("") : `<div class="panel-subtle">No ${tab.label.toLowerCase()} tasks.</div>`;
    }
  };

  const renderCronItem = (job) => `
    <article class="queue-item" data-cron-id="${h(job.id)}">
      <div class="req">${h(job.directive || "")}</div>
      <div class="micro">every ${Math.round(Number(job.intervalMs || 0) / 60000)} min &middot; next run ${h(fmtTime(new Date(Number(job.nextRunAt || 0)).toISOString()))}</div>
      <div class="queue-actions"><button type="button" data-cron-remove="${h(job.id)}">Remove</button></div>
    </article>
  `;

  const loadCron = async () => {
    const { jobs } = await api("/api/cron");
    const list = root.querySelector("#cronList");
    const all = Array.isArray(jobs) ? jobs : [];
    list.innerHTML = all.length ? all.map(renderCronItem).join("") : `<div class="panel-subtle">No schedules yet.</div>`;
  };

  const loadSettings = async () => {
    const { settings } = await api("/api/agent/settings");
    root.querySelector("#settingsScanEnabled").checked = Boolean(settings?.opportunityScanEnabled);
    root.querySelector("#settingsScanIntervalMin").value = Math.round(Number(settings?.opportunityScanIntervalMs || 1800000) / 60000);
    root.querySelector("#settingsRetentionDays").value = Math.round(Number(settings?.taskRetentionMs || 0) / 86400000);
    root.querySelector("#settingsMaxFinished").value = Number(settings?.maxFinishedTasks || 500);
  };

  const loadAll = async () => {
    await Promise.all([loadTasks(), loadCron(), loadSettings()]);
    setHint("Queue loaded.");
  };

  if (!root.dataset.queueBound) {
    root.querySelectorAll("[data-queue-subtab-target]").forEach((b) => b.addEventListener("click", () => setSubtab(root, b.dataset.queueSubtabTarget)));

    root.querySelector("#queueRefreshBtn").addEventListener("click", () => loadAll().catch((e) => setHint(`Refresh failed: ${e.message}`, "bad")));

    root.querySelector("#queueNewBtn").addEventListener("click", async () => {
      const input = root.querySelector("#queueNewRequest");
      const request = String(input.value || "").trim();
      if (!request) return setHint("Type a task request first.", "bad");
      try {
        await api("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request }) });
        input.value = "";
        setSubtab(root, "queued");
        await loadTasks();
        setHint("Task queued.", "ok");
      } catch (e) {
        setHint(`Failed to queue task: ${e.message}`, "bad");
      }
    });

    root.querySelector("#cronAddBtn").addEventListener("click", async () => {
      const directive = String(root.querySelector("#cronDirective").value || "").trim();
      const minutes = Math.max(1, Number(root.querySelector("#cronIntervalMinutes").value || 60));
      if (!directive) return setHint("Type a schedule directive first.", "bad");
      try {
        await api("/api/cron", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directive, intervalMs: minutes * 60000 }) });
        root.querySelector("#cronDirective").value = "";
        await loadCron();
        setHint("Schedule added.", "ok");
      } catch (e) {
        setHint(`Failed to add schedule: ${e.message}`, "bad");
      }
    });

    root.querySelector("#settingsSaveBtn").addEventListener("click", async () => {
      try {
        await api("/api/agent/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            opportunityScanEnabled: root.querySelector("#settingsScanEnabled").checked,
            opportunityScanIntervalMs: Math.max(1, Number(root.querySelector("#settingsScanIntervalMin").value || 30)) * 60000,
            taskRetentionMs: Math.max(0, Number(root.querySelector("#settingsRetentionDays").value || 0)) * 86400000,
            maxFinishedTasks: Math.max(10, Number(root.querySelector("#settingsMaxFinished").value || 500))
          })
        });
        setHint("Settings saved.", "ok");
      } catch (e) {
        setHint(`Failed to save settings: ${e.message}`, "bad");
      }
    });

    root.addEventListener("click", async (evt) => {
      const t = evt.target;
      if (!(t instanceof Element)) return;

      const abortEl = t.closest("[data-abort]");
      if (abortEl instanceof HTMLElement) {
        const taskId = abortEl.dataset.abort;
        try {
          await api(`/api/tasks/${encodeURIComponent(taskId)}/abort`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
          await loadTasks();
          setHint(`Task ${taskId} aborted.`, "ok");
        } catch (e) {
          setHint(`Abort failed: ${e.message}`, "bad");
        }
        return;
      }

      const answerEl = t.closest("[data-answer]");
      if (answerEl instanceof HTMLElement) {
        const taskId = answerEl.dataset.answer;
        const answer = window.prompt("Your answer:");
        if (!answer) return;
        try {
          await api(`/api/tasks/${encodeURIComponent(taskId)}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer }) });
          await loadTasks();
          setHint(`Answered task ${taskId}.`, "ok");
        } catch (e) {
          setHint(`Answer failed: ${e.message}`, "bad");
        }
        return;
      }

      const cronRemoveEl = t.closest("[data-cron-remove]");
      if (cronRemoveEl instanceof HTMLElement) {
        const jobId = cronRemoveEl.dataset.cronRemove;
        try {
          await api(`/api/cron/${encodeURIComponent(jobId)}`, { method: "DELETE" });
          await loadCron();
          setHint("Schedule removed.", "ok");
        } catch (e) {
          setHint(`Remove failed: ${e.message}`, "bad");
        }
      }
    });

    root.dataset.queueBound = "1";
  }

  setSubtab(root, root.dataset.queueTab || "queued");
  try {
    await loadAll();
  } catch (e) {
    setHint(`Queue unavailable: ${e.message}`, "bad");
  }
}
