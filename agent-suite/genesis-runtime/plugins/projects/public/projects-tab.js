import { escapeAttr, escapeHtml } from "/plugin-tab-shared.js";

let observerAppRuntimeRef = {};
let projectsPluginRoot = null;

let refreshProjectsBtn = null;
let saveProjectsBtn = null;
let projectsHintEl = null;
let projectsOverviewListEl = null;
let projectsOverviewSelectEl = null;
let projectsProgressListEl = null;
let projectsProgressSelectEl = null;
let projectsFragmentsListEl = null;
let projectsFragmentsSelectEl = null;
let projectsCompletedListEl = null;
let projectsSettingsListEl = null;
let projectsStateSummaryEl = null;
let projectsWorkspaceListEl = null;
let projectsActiveTasksListEl = null;
let projectsFailuresListEl = null;
let projectsPoliciesListEl = null;
let projectsSubtabButtons = [];
let projectsSubtabPanels = [];

let projectConfigDraft = null;
let activeProjectsSubtabId = "projectsOverviewPanel";
let activeProjectsOverviewSubtabId = "projectsOverviewOverviewPanel";
let activeProjectOverviewKey = "";
let projectFragmentsViewState = {
  projectName: "",
  type: "",
  query: "",
  includeArchived: false,
  selectedFragmentId: "",
  fragments: [],
  chain: null,
  contextText: "",
  contextBlocks: [],
  refs: null,
  versions: [],
  validation: null
};

function ensureProjectsPluginStyles() {
  if (document.getElementById("projectsPluginProgressStyles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "projectsPluginProgressStyles";
  style.textContent = `
    .project-progress-card,
    .project-fragment-card,
    .project-kanban-column,
    .project-timeline-panel {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: 10px;
      padding: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .project-progress-dashboard,
    .project-progress-summary,
    .project-kanban-column,
    .project-kanban-list,
    .project-progress-card,
    .project-fragment-form,
    .project-fragment-grid,
    .project-timeline-panel,
    .project-timeline-list {
      display: grid;
      gap: 10px;
    }
    .project-progress-head,
    .project-progress-meta,
    .project-kanban-head {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 8px;
    }
    .project-progress-summary {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .project-kanban-board {
      display: grid;
      grid-template-columns: repeat(5, minmax(210px, 1fr));
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .project-kanban-column {
      align-content: start;
      min-width: 170px;
      padding: 10px;
    }
    .project-kanban-head {
      align-items: center;
    }
    .project-progress-card {
      padding: 10px;
      gap: 8px;
    }
    .project-progress-card.done {
      opacity: 0.82;
    }
    .project-progress-head {
      align-items: flex-start;
    }
    .project-progress-head strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .project-progress-meter {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.11);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .project-progress-meter span {
      display: block;
      height: 100%;
      min-width: 2px;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(79, 201, 122, 0.9), rgba(200, 169, 106, 0.95));
    }
    .project-progress-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      color: var(--muted);
      font-size: 0.78rem;
    }
    .project-progress-meta span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .project-progress-alert {
      border: 1px solid rgba(230, 176, 74, 0.26);
      background: rgba(230, 176, 74, 0.1);
      color: var(--accent);
      border-radius: 8px;
      padding: 7px 8px;
      font-size: 0.8rem;
    }
    .project-fragment-grid {
      grid-template-columns: minmax(250px, 0.72fr) minmax(360px, 1.45fr);
      align-items: start;
    }
    .project-fragment-workspace {
      display: grid;
      gap: 10px;
    }
    .project-fragment-toolbar {
      display: grid;
      grid-template-columns: minmax(150px, 0.45fr) minmax(160px, 0.55fr) auto;
      gap: 8px;
      align-items: end;
    }
    .project-fragment-list {
      display: grid;
      gap: 7px;
      max-height: 520px;
      overflow: auto;
      padding-right: 2px;
    }
    .project-fragment-card {
      display: grid;
      gap: 7px;
      padding: 10px;
      text-align: left;
      color: inherit;
      width: 100%;
      cursor: pointer;
    }
    .project-fragment-card.active {
      border-color: rgba(200, 169, 106, 0.55);
      background: rgba(200, 169, 106, 0.12);
    }
    .project-fragment-form {
      align-content: start;
    }
    .project-fragment-form textarea {
      min-height: 180px;
      resize: vertical;
    }
    .project-fragment-type-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .project-fragment-type-pill {
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 3px 7px;
      color: var(--muted);
      font-size: 0.75rem;
    }
    .project-fragment-editor {
      display: grid;
      gap: 8px;
    }
    .project-fragment-editor-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .project-fragment-editor textarea {
      min-height: 280px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      line-height: 1.45;
    }
    .project-fragment-context-preview {
      max-height: 320px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.78rem;
      line-height: 1.45;
    }
    .project-fragment-chain {
      display: grid;
      gap: 8px;
      max-height: 360px;
      overflow: auto;
    }
    .project-fragment-chain-row {
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px;
      display: grid;
      gap: 5px;
    }
    .project-fragment-variation-row {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .project-progress-ref-list {
      display: grid;
      gap: 5px;
      margin-top: 2px;
    }
    .project-progress-ref {
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 6px 7px;
      font-size: 0.8rem;
      line-height: 1.35;
    }
    .project-timeline-list {
      position: relative;
      gap: 0;
    }
    .project-timeline-item {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 8px;
      padding: 0 0 12px;
      position: relative;
    }
    .project-timeline-item::before {
      content: "";
      position: absolute;
      left: 6px;
      top: 10px;
      bottom: -2px;
      width: 1px;
      background: rgba(255, 255, 255, 0.13);
    }
    .project-timeline-item:last-child {
      padding-bottom: 0;
    }
    .project-timeline-item:last-child::before {
      display: none;
    }
    .project-timeline-dot {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      margin-top: 3px;
      background: var(--accent);
      border: 2px solid rgba(26, 15, 0, 0.65);
      box-shadow: 0 0 0 2px rgba(200, 169, 106, 0.22);
      z-index: 1;
    }
    @media (max-width: 980px) {
      .project-progress-summary {
        grid-template-columns: 1fr;
      }
      .project-kanban-board {
        grid-template-columns: repeat(5, minmax(230px, 1fr));
      }
      .project-fragment-grid {
        grid-template-columns: 1fr;
      }
      .project-fragment-toolbar,
      .project-fragment-editor-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function cloneJson(value = null) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value == null ? null : value));
}


function formatDateTime(value) {
  if (!value) {
    return "Never";
  }
  return new Date(value).toLocaleString();
}

async function loadRuntimeOptions() {
  if (typeof observerAppRuntimeRef?.loadRuntimeOptions === "function") {
    await observerAppRuntimeRef.loadRuntimeOptions();
  }
}

async function loadCronJobs() {
  if (typeof observerAppRuntimeRef?.loadCronJobs === "function") {
    await observerAppRuntimeRef.loadCronJobs();
  }
}

async function loadTaskQueue() {
  if (typeof observerAppRuntimeRef?.loadTaskQueue === "function") {
    await observerAppRuntimeRef.loadTaskQueue();
  }
}

function activateProjectsSubtab(tabId = "projectsOverviewPanel") {
  const nextTabId = String(tabId || "projectsOverviewPanel").trim() || "projectsOverviewPanel";
  activeProjectsSubtabId = nextTabId;
  projectsSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === nextTabId);
  });
  projectsSubtabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.projectsSubtabTarget === nextTabId);
  });
}

function getProjectsOverviewSubtabButtons() {
  if (!(projectsPluginRoot instanceof HTMLElement)) {
    return [];
  }
  return Array.from(projectsPluginRoot.querySelectorAll("[data-projects-overview-subtab-target]"));
}

function getProjectsOverviewSubtabPanels() {
  if (!(projectsPluginRoot instanceof HTMLElement)) {
    return [];
  }
  return Array.from(projectsPluginRoot.querySelectorAll(".projects-overview-subtab-panel"));
}

function bindProjectsOverviewSubtabButtons() {
  getProjectsOverviewSubtabButtons().forEach((button) => {
    button.onclick = () => activateProjectsOverviewSubtab(button.dataset.projectsOverviewSubtabTarget);
  });
}

function activateProjectsOverviewSubtab(tabId = "projectsOverviewOverviewPanel") {
  const panels = getProjectsOverviewSubtabPanels();
  const buttons = getProjectsOverviewSubtabButtons();
  const nextTabId = panels.some((panel) => panel.id === tabId)
    ? tabId
    : (panels[0]?.id || "projectsOverviewOverviewPanel");
  activeProjectsOverviewSubtabId = nextTabId;
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === nextTabId);
  });
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.projectsOverviewSubtabTarget === nextTabId);
  });
}

function projectDurationToDisplay(value, unit = "ms") {
  const raw = Number(value || 0);
  if (unit === "hours") return String((raw / (60 * 60 * 1000)).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  if (unit === "seconds") return String((raw / 1000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  if (unit === "days") return String((raw / (24 * 60 * 60 * 1000)).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  return String(raw);
}

function projectDisplayToDuration(value, unit = "ms") {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (unit === "hours") return Math.round(numeric * 60 * 60 * 1000);
  if (unit === "seconds") return Math.round(numeric * 1000);
  if (unit === "days") return Math.round(numeric * 24 * 60 * 60 * 1000);
  return Math.round(numeric);
}

function renderProjectConfigEditor() {
  if (!projectConfigDraft) {
    projectsOverviewSelectEl.innerHTML = `<option value="">Project overview unavailable</option>`;
    projectsOverviewSelectEl.disabled = true;
    projectsOverviewListEl.innerHTML = `<div class="panel-subtle">Project overview unavailable.</div>`;
    projectsProgressSelectEl.innerHTML = `<option value="">Project progress unavailable</option>`;
    projectsProgressSelectEl.disabled = true;
    projectsProgressListEl.innerHTML = `<div class="panel-subtle">Project progress unavailable.</div>`;
    projectsFragmentsSelectEl.innerHTML = `<option value="">Project fragments unavailable</option>`;
    projectsFragmentsSelectEl.disabled = true;
    projectsFragmentsListEl.innerHTML = `<div class="panel-subtle">Project fragments unavailable.</div>`;
    projectsCompletedListEl.innerHTML = `<div class="panel-subtle">Completed project jobs unavailable.</div>`;
    projectsSettingsListEl.innerHTML = `<div class="panel-subtle">Project configuration unavailable.</div>`;
    projectsStateSummaryEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsWorkspaceListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsActiveTasksListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsFailuresListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    projectsPoliciesListEl.innerHTML = `<div class="panel-subtle">Project state unavailable.</div>`;
    return;
  }

  const projects = projectConfigDraft.projects || {};
  const state = projectConfigDraft.state || {};
  const summary = state.summary || {};
  const projectPanels = Array.isArray(state.projectPanels) ? state.projectPanels : [];
  const workspaceProjects = Array.isArray(state.workspaceProjects) ? state.workspaceProjects : [];
  const activeTasks = Array.isArray(state.activeProjectTasks) ? state.activeProjectTasks : [];
  const recentFailures = Array.isArray(state.recentProjectFailures) ? state.recentProjectFailures : [];
  const recentImports = Array.isArray(state.recentImports) ? state.recentImports : [];
  const rolePlaybooks = Array.isArray(state.rolePlaybooks) ? state.rolePlaybooks : [];
  const policies = state.policies || {};
  const completedProjectJobs = projectPanels.flatMap((project) => {
    const recentJobs = Array.isArray(project?.recentJobs) ? project.recentJobs : [];
    const readyExports = Array.isArray(project?.history?.readyExports) ? project.history.readyExports : [];
    const latestReady = readyExports[0] || null;
    const settledJobs = recentJobs.filter((entry) => !["queued", "in_progress", "waiting_for_user"].includes(String(entry?.finalStatus || "").trim()));
    if (settledJobs.length) {
      return settledJobs.map((job) => ({
        projectName: String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)",
        sourceName: String(project?.sourceName || "").trim(),
        stage: String(project?.currentStage || "").trim(),
        outputPath: String(latestReady?.path || "").trim(),
        outputAt: Number(latestReady?.occurredAt || 0),
        job
      }));
    }
    if (latestReady?.path) {
      return [{
        projectName: String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)",
        sourceName: String(project?.sourceName || "").trim(),
        stage: "completed",
        outputPath: String(latestReady.path || "").trim(),
        outputAt: Number(latestReady.occurredAt || 0),
        job: null
      }];
    }
    return [];
  }).sort((left, right) => {
    const leftTime = Number(left?.job?.updatedAt || left?.outputAt || 0);
    const rightTime = Number(right?.job?.updatedAt || right?.outputAt || 0);
    return rightTime - leftTime;
  });
  const activeOverviewProjects = projectPanels.filter((project) =>
    String(project?.currentStage || "").trim().toLowerCase() !== "completed"
  );
  const fallbackOverviewProjects = activeOverviewProjects.length
    ? activeOverviewProjects
    : (projectPanels[0] ? [projectPanels[0]] : []);
  const projectOptionList = fallbackOverviewProjects.map((project, index) => ({
    key: getProjectOverviewKey(project, index),
    label: getProjectOverviewLabel(project)
  }));
  const selectedProjectKey = projectOptionList.some((entry) => entry.key === activeProjectOverviewKey)
    ? activeProjectOverviewKey
    : (projectOptionList[0]?.key || "");
  const selectedProjectIndex = projectOptionList.findIndex((entry) => entry.key === selectedProjectKey);
  const selectedProject = selectedProjectIndex >= 0 ? fallbackOverviewProjects[selectedProjectIndex] : null;

  activeProjectOverviewKey = selectedProjectKey;
  projectsOverviewSelectEl.disabled = !projectOptionList.length;
  projectsOverviewSelectEl.innerHTML = projectOptionList.length
    ? projectOptionList.map((entry) => `<option value="${escapeAttr(entry.key)}"${entry.key === selectedProjectKey ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")
    : `<option value="">No active projects</option>`;
  projectsOverviewSelectEl.onchange = () => {
    activeProjectOverviewKey = String(projectsOverviewSelectEl.value || "").trim();
    renderProjectConfigEditor();
  };
  projectsProgressSelectEl.disabled = !projectOptionList.length;
  projectsProgressSelectEl.innerHTML = projectOptionList.length
    ? projectOptionList.map((entry) => `<option value="${escapeAttr(entry.key)}"${entry.key === selectedProjectKey ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")
    : `<option value="">No active projects</option>`;
  projectsProgressSelectEl.onchange = () => {
    activeProjectOverviewKey = String(projectsProgressSelectEl.value || "").trim();
    renderProjectConfigEditor();
  };
  projectsFragmentsSelectEl.disabled = !projectOptionList.length;
  projectsFragmentsSelectEl.innerHTML = projectOptionList.length
    ? projectOptionList.map((entry) => `<option value="${escapeAttr(entry.key)}"${entry.key === selectedProjectKey ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")
    : `<option value="">No active projects</option>`;
  projectsFragmentsSelectEl.onchange = () => {
    activeProjectOverviewKey = String(projectsFragmentsSelectEl.value || "").trim();
    renderProjectConfigEditor();
  };

  projectsOverviewListEl.innerHTML = selectedProject
    ? renderProjectOverviewCard(selectedProject)
    : `<div class="panel-subtle">No active project overviews are available right now.</div>`;
  projectsProgressListEl.innerHTML = selectedProject
    ? renderProjectWorkBoard(selectedProject, summary)
    : `<div class="panel-subtle">Select a project to see its work board.</div>`;
  projectsFragmentsListEl.innerHTML = selectedProject
    ? renderProjectFragmentsPanel(selectedProject)
    : `<div class="panel-subtle">Select a project to see its fragments.</div>`;
  if (selectedProject) {
    bindProjectFragmentsPanelEvents(selectedProject);
    loadProjectFragmentsPanel(selectedProject).catch((error) => {
      projectsHintEl.textContent = `Fragment load failed: ${error.message}`;
    });
  }
  bindProjectsOverviewSubtabButtons();
  activateProjectsOverviewSubtab(activeProjectsOverviewSubtabId || "projectsOverviewOverviewPanel");

  projectsOverviewListEl.querySelectorAll("[data-remove-checklist-item]").forEach((btn) => {
    btn.onclick = async () => {
      const itemText = String(btn.dataset.removeChecklistItem || "").trim();
      const filePath = String(btn.dataset.checklistFilePath || "").trim();
      if (!itemText || !filePath) return;
      projectsHintEl.textContent = "Removing item...";
      try {
        const r = await fetch("/api/projects/checklist/remove-item", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filePath, itemText })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "failed to remove item");
        projectsHintEl.textContent = "Item removed.";
        await loadProjectConfig();
      } catch (error) {
        projectsHintEl.textContent = `Remove failed: ${error.message}`;
      }
    };
  });

  projectsOverviewListEl.querySelectorAll("[data-remove-project-role]").forEach((btn) => {
    btn.onclick = async () => {
      const roleName = String(btn.dataset.removeProjectRole || "").trim();
      const roleTaskPath = String(btn.dataset.roleTaskPath || "").trim();
      if (!roleName || !roleTaskPath) return;
      projectsHintEl.textContent = `Removing role ${roleName}...`;
      try {
        const r = await fetch("/api/projects/checklist/remove-role", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roleTaskPath, roleName })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "failed to remove role");
        projectsHintEl.textContent = "Role removed.";
        await loadProjectConfig();
      } catch (error) {
        projectsHintEl.textContent = `Remove failed: ${error.message}`;
      }
    };
  });

  projectsOverviewListEl.querySelectorAll("[data-add-role-btn]").forEach((btn) => {
    btn.onclick = async () => {
      const roleTaskPath = String(btn.dataset.roleTaskPath || "").trim();
      const card = btn.closest(".brain-editor-card");
      const roleName = String(card?.querySelector("[data-add-role-select]")?.value || "").trim();
      const reason = String(card?.querySelector("[data-add-role-reason]")?.value || "").trim();
      if (!roleTaskPath || !roleName) {
        projectsHintEl.textContent = "Select a role first.";
        return;
      }
      projectsHintEl.textContent = `Adding role ${roleName}...`;
      try {
        const r = await fetch("/api/projects/checklist/add-role", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roleTaskPath, roleName, reason })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "failed to add role");
        projectsHintEl.textContent = "Role added.";
        await loadProjectConfig();
      } catch (error) {
        projectsHintEl.textContent = `Add failed: ${error.message}`;
      }
    };
  });
  projectsCompletedListEl.innerHTML = completedProjectJobs.length
    ? completedProjectJobs.slice(0, 24).map((entry) => renderCompletedProjectJobCard(entry)).join("")
    : `<div class="panel-subtle">No completed or exported project jobs are recorded yet.</div>`;

  projectsSettingsListEl.innerHTML = `
    <div class="projects-settings-stack">
      <label class="project-setting-row stack-field">
        <strong>Max active work packages per project</strong>
        <span class="micro">Concurrent focused project-cycle packages allowed for one project.</span>
        <input type="number" min="1" max="12" step="1" data-project-field="maxActiveWorkPackagesPerProject" value="${escapeHtml(String(projects.maxActiveWorkPackagesPerProject || 6))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Project retry cooldown (hours)</strong>
        <span class="micro">Minimum delay before the same project work item is eligible again.</span>
        <input type="number" min="0" max="168" step="0.5" data-project-field="projectWorkRetryCooldownMs" data-project-unit="hours" value="${escapeHtml(projectDurationToDisplay(projects.projectWorkRetryCooldownMs, "hours"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Idle scan wait after activity (seconds)</strong>
        <span class="micro">How long the system waits after activity before opportunity scanning can run.</span>
        <input type="number" min="5" max="3600" step="1" data-project-field="opportunityScanIdleMs" data-project-unit="seconds" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanIdleMs, "seconds"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Opportunity scan interval (seconds)</strong>
        <span class="micro">How often the idle scan wakes up to inspect project opportunities.</span>
        <input type="number" min="10" max="3600" step="1" data-project-field="opportunityScanIntervalMs" data-project-unit="seconds" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanIntervalMs, "seconds"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Opportunity retention window (days)</strong>
        <span class="micro">How long scan-memory entries are kept before pruning.</span>
        <input type="number" min="0.1" max="365" step="0.5" data-project-field="opportunityScanRetentionMs" data-project-unit="days" value="${escapeHtml(projectDurationToDisplay(projects.opportunityScanRetentionMs, "days"))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Queued backlog cap before scan skips</strong>
        <span class="micro">If the queue reaches this depth, opportunity scan will not add more project work.</span>
        <input type="number" min="1" max="50" step="1" data-project-field="opportunityScanMaxQueuedBacklog" value="${escapeHtml(String(projects.opportunityScanMaxQueuedBacklog || 5))}" />
      </label>
      <label class="project-setting-row stack-field">
        <strong>Minimum concrete targets for no-change</strong>
        <span class="micro">Project-cycle workers must inspect at least this many concrete targets before claiming no safe change.</span>
        <input type="number" min="1" max="6" step="1" data-project-field="noChangeMinimumConcreteTargets" value="${escapeHtml(String(projects.noChangeMinimumConcreteTargets || 3))}" />
      </label>
    </div>
    <div class="project-toggle-list">
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoCreateProjectTodo" ${projects.autoCreateProjectTodo !== false ? "checked" : ""} />
        <span>
          <strong>Auto-create PROJECT-TODO.md</strong>
          <div class="micro">Seed missing project todo files from native inspection.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoCreateProjectRoleTasks" ${projects.autoCreateProjectRoleTasks !== false ? "checked" : ""} />
        <span>
          <strong>Auto-create PROJECT-ROLE-TASKS.md</strong>
          <div class="micro">Seed missing role task boards from project inspection.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoImportProjects" ${projects.autoImportProjects !== false ? "checked" : ""} />
        <span>
          <strong>Auto-import repository projects</strong>
          <div class="micro">Pull fresh projects into the workspace during idle rotation.</div>
        </span>
      </label>
      <label class="toggle project-toggle-row">
        <input type="checkbox" data-project-field="autoExportReadyProjects" ${projects.autoExportReadyProjects !== false ? "checked" : ""} />
        <span>
          <strong>Auto-export ready projects</strong>
          <div class="micro">Move completed workspace projects into observer output automatically.</div>
        </span>
      </label>
    </div>
  `;

  projectsSettingsListEl.querySelectorAll("[data-project-field]").forEach((input) => {
    input.onchange = () => {
      const field = String(input.dataset.projectField || "").trim();
      if (!field || !projectConfigDraft?.projects) {
        return;
      }
      if (input.type === "checkbox") {
        projectConfigDraft.projects[field] = input.checked;
        return;
      }
      const unit = String(input.dataset.projectUnit || "").trim();
      const numericValue = Number(input.value || 0);
      projectConfigDraft.projects[field] = unit
        ? projectDisplayToDuration(numericValue, unit)
        : Math.round(numericValue);
    };
  });

  projectsStateSummaryEl.innerHTML = `
    <div class="summary-box">
      <strong>Workspace projects</strong>
      <div class="summary-pill">${escapeHtml(String(summary.workspaceProjectCount || 0))}</div>
      <div class="micro">Projects currently present in the workspace container.</div>
    </div>
    <div class="summary-box">
      <strong>Active project tasks</strong>
      <div class="summary-pill">${escapeHtml(String(summary.activeProjectTaskCount || 0))}</div>
      <div class="micro">Queued or running project-cycle tasks.</div>
    </div>
    <div class="summary-box">
      <strong>Waiting project tasks</strong>
      <div class="summary-pill">${escapeHtml(String(summary.waitingProjectTaskCount || 0))}</div>
      <div class="micro">Project tasks currently blocked on a user answer.</div>
    </div>
    <div class="summary-box">
      <strong>Recent project failures</strong>
      <div class="summary-pill">${escapeHtml(String(summary.recentProjectFailureCount || 0))}</div>
      <div class="micro">Recent project-cycle failures captured in history.</div>
    </div>
  `;

  projectsWorkspaceListEl.innerHTML = workspaceProjects.length
    ? workspaceProjects.map((project) => `
      <div class="project-list-row">
        <div class="brain-row-actions">
          <strong>${escapeHtml(project.name || "(unnamed)")}</strong>
          <button class="secondary" data-abort-project="${escapeAttr(project.name || "")}">Abort</button>
        </div>
        <div class="micro">${escapeHtml(project.activeTaskCount ? `${project.activeTaskCount} active task${project.activeTaskCount === 1 ? "" : "s"}` : "Idle")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No workspace projects are loaded right now.</div>`;

  projectsWorkspaceListEl.querySelectorAll("[data-abort-project]").forEach((btn) => {
    btn.onclick = async () => {
      const projectName = String(btn.dataset.abortProject || "").trim();
      if (!projectName) return;
      if (!confirm(`Abort project "${projectName}"?\n\nThis will export it to the archive folder and remove it from the workspace.`)) return;
      projectsHintEl.textContent = `Aborting ${projectName}...`;
      btn.disabled = true;
      try {
        const r = await fetch("/api/projects/workspace/abort", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectName })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "failed to abort project");
        projectsHintEl.textContent = `Aborted: ${projectName}`;
        await loadProjectConfig();
      } catch (error) {
        projectsHintEl.textContent = `Abort failed: ${error.message}`;
        btn.disabled = false;
      }
    };
  });

  projectsActiveTasksListEl.innerHTML = activeTasks.length
    ? activeTasks.map((task) => `
      <div class="project-list-row">
        <div class="project-item-title">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
        </div>
        <div><span class="brain-pill">${escapeHtml(task.requestedBrainLabel || "worker")}</span></div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} - ${escapeHtml(String(task.status || "").replaceAll("_", " "))} - ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.focus || "No focus recorded.")}</div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No active project-cycle tasks.</div>`;

  projectsFailuresListEl.innerHTML = recentFailures.length
    ? recentFailures.map((task) => `
      <div class="project-list-row">
        <div class="project-item-title">
          <strong>${escapeHtml(task.codename || task.id || "Task")}</strong>
        </div>
        <div><span class="brain-pill">${escapeHtml(task.failureClassification || "unknown")}</span></div>
        <div class="micro">${escapeHtml(task.projectName || "(unknown project)")} - ${escapeHtml(formatDateTime(task.updatedAt))}</div>
        <div class="micro">${escapeHtml(task.summary || "No summary recorded.")}</div>
        ${task.toolLoopSummary && task.toolLoopSummary !== task.summary ? `<div class="micro">${escapeHtml(task.toolLoopSummary)}</div>` : ""}
      </div>
    `).join("")
    : `<div class="panel-subtle">No recent project-cycle failures.</div>`;

  projectsPoliciesListEl.innerHTML = `
    <div class="projects-policy-stack">
      <div class="project-policy-group">
        <strong>Recent imports</strong>
        ${recentImports.length
          ? recentImports.map((entry) => `<div class="project-policy-line micro">${escapeHtml(entry.sourceName || "(unknown)")} - ${escapeHtml(formatDateTime(entry.importedAt))}</div>`).join("")
          : `<div class="panel-subtle">No recent project imports recorded.</div>`}
      </div>
      <div class="project-policy-group">
        <strong>Role playbooks (${escapeHtml(String(rolePlaybooks.length || 0))})</strong>
        ${rolePlaybooks.length
          ? rolePlaybooks.slice(0, 8).map((entry) => `<div class="project-policy-line micro"><strong>${escapeHtml(entry.name)}</strong><br>${escapeHtml(entry.playbook)}</div>`).join("")
          : `<div class="panel-subtle">No role playbooks registered.</div>`}
      </div>
      <div class="project-policy-group">
        <strong>Fixed policies</strong>
        ${[
          ...(Array.isArray(policies.targetScoring) ? policies.targetScoring.map((entry) => `<div class="project-policy-line micro"><strong>Target scoring</strong><br>${escapeHtml(entry)}</div>`) : []),
          ...(Array.isArray(policies.loopRepair) ? policies.loopRepair.map((entry) => `<div class="project-policy-line micro"><strong>Loop repair</strong><br>${escapeHtml(entry)}</div>`) : [])
        ].join("") || `<div class="panel-subtle">No project policies exposed.</div>`}
      </div>
    </div>
  `;
}

function getProjectOverviewKey(project = {}, index = 0) {
  const workspacePath = String(project?.workspace?.path || "").trim().toLowerCase();
  const sourcePath = String(project?.source?.path || "").trim().toLowerCase();
  const name = String(project?.name || "").trim().toLowerCase();
  const sourceName = String(project?.sourceName || "").trim().toLowerCase();
  return workspacePath || sourcePath || `${sourceName}::${name}` || `project-${index}`;
}

function getProjectOverviewLabel(project = {}) {
  const name = String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)";
  const stage = formatProjectStageLabel(project?.currentStage);
  return `${name} | ${stage}`;
}

function getProjectFragmentTypes(project = {}) {
  const fragments = project?.fragments && typeof project.fragments === "object" ? project.fragments : {};
  const fromSummary = Array.isArray(fragments.types) ? fragments.types.map((entry) => String(entry?.type || "").trim()).filter(Boolean) : [];
  return fromSummary.length ? fromSummary : ["prose", "character", "guideline", "knowledge", "note", "summary", "marker"];
}

function fragmentTagsToInput(tags = []) {
  return (Array.isArray(tags) ? tags : []).map((entry) => String(entry || "").trim()).filter(Boolean).join(", ");
}

function fragmentInputToTags(value = "") {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function fragmentInputToRefs(value = "") {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function getProjectFragmentProjectName(project = {}) {
  return String(project?.name || project?.sourceName || "").trim();
}

async function fetchProjectFragmentJson(url = "", options = {}) {
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "project fragment request failed");
  }
  return json;
}

function getSelectedProjectFragment() {
  const selectedId = String(projectFragmentsViewState.selectedFragmentId || "").trim();
  const fragments = Array.isArray(projectFragmentsViewState.fragments) ? projectFragmentsViewState.fragments : [];
  return fragments.find((fragment) => String(fragment?.id || "") === selectedId) || null;
}

function renderProjectFragmentList() {
  const listEl = projectsFragmentsListEl?.querySelector("[data-fragment-list]");
  const countEl = projectsFragmentsListEl?.querySelector("[data-fragment-count]");
  if (!listEl) return;
  const fragments = Array.isArray(projectFragmentsViewState.fragments) ? projectFragmentsViewState.fragments : [];
  if (countEl) {
    countEl.textContent = `${fragments.length} fragment${fragments.length === 1 ? "" : "s"}`;
  }
  listEl.innerHTML = fragments.length
    ? fragments.map((fragment) => `
      <button type="button" class="project-fragment-card ${fragment.id === projectFragmentsViewState.selectedFragmentId ? "active" : ""}" data-select-project-fragment="${escapeAttr(fragment.id)}">
        <div class="project-section-head">
          <strong>${escapeHtml(fragment.name || fragment.id || "Fragment")}</strong>
          <span class="micro">${escapeHtml(fragment.id || "")} | ${escapeHtml(fragment.type || "")}${fragment.sticky ? " | sticky" : ""}${fragment.archived ? " | archived" : ""}</span>
        </div>
        ${fragment.description ? `<div class="micro">${escapeHtml(fragment.description)}</div>` : ""}
        ${fragment.content ? `<div class="panel-subtle">${escapeHtml(String(fragment.content || "").trim().slice(0, 220))}${String(fragment.content || "").length > 220 ? "..." : ""}</div>` : ""}
        <div class="micro">v${escapeHtml(String(fragment.version || 1))} | ${escapeHtml(String(fragment.content || "").length)} chars | ${escapeHtml(formatDateTime(fragment.updatedAt))}</div>
      </button>
    `).join("")
    : `<div class="panel-subtle">No fragments match this filter.</div>`;
  listEl.querySelectorAll("[data-select-project-fragment]").forEach((button) => {
    button.onclick = async () => {
      projectFragmentsViewState.selectedFragmentId = String(button.dataset.selectProjectFragment || "").trim();
      if (projectFragmentsViewState.projectName && projectFragmentsViewState.selectedFragmentId) {
        await loadSelectedFragmentDetails(projectFragmentsViewState.projectName, projectFragmentsViewState.selectedFragmentId).catch(() => {
          projectFragmentsViewState.refs = null;
          projectFragmentsViewState.versions = [];
        });
      }
      renderProjectFragmentList();
      renderProjectFragmentEditor();
      renderProjectFragmentChain();
    };
  });
}

function renderProjectFragmentEditor() {
  const editorEl = projectsFragmentsListEl?.querySelector("[data-fragment-editor]");
  if (!editorEl) return;
  const fragment = getSelectedProjectFragment();
  const types = getProjectFragmentTypes(projectConfigDraft?.state?.projectPanels?.find((project) => getProjectFragmentProjectName(project) === projectFragmentsViewState.projectName) || {});
  const typeOptions = types.map((type) => `<option value="${escapeAttr(type)}"${fragment?.type === type ? " selected" : ""}>${escapeHtml(type)}</option>`).join("");
  editorEl.innerHTML = `
    <div class="project-section-head">
      <strong>${escapeHtml(fragment ? "Edit Fragment" : "New Fragment")}</strong>
      <span class="micro">${fragment ? `${escapeHtml(fragment.id)} | v${escapeHtml(String(fragment.version || 1))}` : "Create project memory"}</span>
    </div>
    <div class="project-fragment-editor" data-project-fragment-form>
      <div class="project-fragment-editor-grid">
        <label class="stack-field"><strong>Type</strong><select data-fragment-type>${typeOptions || `<option value="note">note</option>`}</select></label>
        <label class="stack-field"><strong>Order</strong><input type="number" step="1" data-fragment-order value="${escapeAttr(String(fragment?.order || 0))}" /></label>
      </div>
      <label class="stack-field"><strong>Name</strong><input type="text" data-fragment-name value="${escapeAttr(fragment?.name || "")}" placeholder="Character, scene, rule, fact, note" /></label>
      <label class="stack-field"><strong>Description</strong><input type="text" data-fragment-description value="${escapeAttr(fragment?.description || "")}" placeholder="Short lookup summary" /></label>
      <label class="stack-field"><strong>Content</strong><textarea data-fragment-content placeholder="Fragment content">${escapeHtml(fragment?.content || "")}</textarea></label>
      <label class="stack-field"><strong>Tags</strong><input type="text" data-fragment-tags value="${escapeAttr(fragmentTagsToInput(fragment?.tags || []))}" placeholder="comma, separated, tags" /></label>
      <label class="stack-field"><strong>Refs</strong><input type="text" data-fragment-refs value="${escapeAttr(fragmentTagsToInput(fragment?.refs || []))}" placeholder="fragment ids, comma separated" /></label>
      <div class="project-fragment-editor-grid">
        <label class="setting-inline"><input type="checkbox" data-fragment-sticky ${fragment?.sticky ? "checked" : ""} /> Sticky in context</label>
        <label class="setting-inline"><input type="checkbox" data-fragment-placement ${fragment?.placement === "system" ? "checked" : ""} /> Place in system context</label>
      </div>
      <div class="controls">
        <button type="button" data-save-project-fragment>${fragment ? "Save changes" : "Create fragment"}</button>
        ${fragment ? `<button class="secondary" type="button" data-new-project-fragment>New</button>` : ""}
        ${fragment && !fragment.archived ? `<button class="secondary" type="button" data-archive-project-fragment>Archive</button>` : ""}
        ${fragment?.archived ? `<button class="secondary" type="button" data-restore-project-fragment>Restore</button>` : ""}
      </div>
      ${fragment ? renderProjectFragmentRefsAndVersions() : ""}
    </div>
  `;
  editorEl.querySelector("[data-save-project-fragment]").onclick = () => saveProjectFragmentEditor().catch((error) => {
    projectsHintEl.textContent = `Fragment save failed: ${error.message}`;
  });
  const newBtn = editorEl.querySelector("[data-new-project-fragment]");
  if (newBtn) {
    newBtn.onclick = () => {
      projectFragmentsViewState.selectedFragmentId = "";
      renderProjectFragmentList();
      renderProjectFragmentEditor();
    };
  }
  const archiveBtn = editorEl.querySelector("[data-archive-project-fragment]");
  if (archiveBtn) {
    archiveBtn.onclick = () => archiveOrRestoreProjectFragment("archive").catch((error) => {
      projectsHintEl.textContent = `Archive failed: ${error.message}`;
    });
  }
  const restoreBtn = editorEl.querySelector("[data-restore-project-fragment]");
  if (restoreBtn) {
    restoreBtn.onclick = () => archiveOrRestoreProjectFragment("restore").catch((error) => {
      projectsHintEl.textContent = `Restore failed: ${error.message}`;
    });
  }
  editorEl.querySelectorAll("[data-revert-fragment-version]").forEach((button) => {
    button.onclick = () => revertProjectFragmentVersion(Number(button.dataset.revertFragmentVersion || 0)).catch((error) => {
      projectsHintEl.textContent = `Revert failed: ${error.message}`;
    });
  });
}

function renderProjectFragmentRefsAndVersions() {
  const refs = projectFragmentsViewState.refs && typeof projectFragmentsViewState.refs === "object" ? projectFragmentsViewState.refs : {};
  const versions = Array.isArray(projectFragmentsViewState.versions) ? projectFragmentsViewState.versions : [];
  const refLines = Array.isArray(refs.refs) ? refs.refs : [];
  const backRefs = Array.isArray(refs.backRefs) ? refs.backRefs : [];
  return `
    <div class="project-fragment-editor-grid">
      <section class="brain-editor-card">
        <div class="project-section-head"><strong>Refs</strong><span class="micro">${escapeHtml(String(refLines.length))} out | ${escapeHtml(String(backRefs.length))} back</span></div>
        <div class="stack-list micro">
          ${refLines.length ? refLines.map((entry) => `<div>${escapeHtml(entry.id)} ${entry.found ? "" : "(missing)"}</div>`).join("") : `<div class="panel-subtle">No outgoing refs.</div>`}
          ${backRefs.length ? `<div><strong>Backrefs</strong></div>${backRefs.map((entry) => `<div>${escapeHtml(entry.id)} | ${escapeHtml(entry.name || "")}</div>`).join("")}` : ""}
        </div>
      </section>
      <section class="brain-editor-card">
        <div class="project-section-head"><strong>Versions</strong><span class="micro">${escapeHtml(String(versions.length))} saved</span></div>
        <div class="stack-list micro">
          ${versions.length ? versions.slice().reverse().slice(0, 6).map((entry) => `
            <div class="project-fragment-variation-row">
              <span>v${escapeHtml(String(entry.version || 0))} | ${escapeHtml(formatDateTime(entry.createdAt))}${entry.reason ? ` | ${escapeHtml(entry.reason)}` : ""}</span>
              <button class="secondary" type="button" data-revert-fragment-version="${escapeAttr(String(entry.version || 0))}">Revert</button>
            </div>
          `).join("") : `<div class="panel-subtle">No prior versions yet.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderProjectFragmentContextPreview() {
  const contextEl = projectsFragmentsListEl?.querySelector("[data-fragment-context]");
  const blockCountEl = projectsFragmentsListEl?.querySelector("[data-fragment-context-count]");
  if (!contextEl) return;
  const blocks = Array.isArray(projectFragmentsViewState.contextBlocks) ? projectFragmentsViewState.contextBlocks : [];
  if (blockCountEl) {
    blockCountEl.textContent = `${blocks.length} block${blocks.length === 1 ? "" : "s"}`;
  }
  contextEl.textContent = projectFragmentsViewState.contextText || "No fragment context is available yet.";
}

function renderProjectFragmentValidation() {
  const validationEl = projectsFragmentsListEl?.querySelector("[data-fragment-validation]");
  if (!validationEl) return;
  const issues = Array.isArray(projectFragmentsViewState.validation?.issues) ? projectFragmentsViewState.validation.issues : [];
  validationEl.innerHTML = issues.length
    ? issues.slice(0, 8).map((issue) => `<div class="project-progress-alert">${escapeHtml(issue.message || issue.code || "Fragment issue")}</div>`).join("")
    : `<div class="panel-subtle">Fragment validation passed.</div>`;
}

function renderProjectFragmentChain() {
  const chainEl = projectsFragmentsListEl?.querySelector("[data-fragment-chain]");
  if (!chainEl) return;
  const entries = Array.isArray(projectFragmentsViewState.chain?.entries) ? projectFragmentsViewState.chain.entries : [];
  const selectedFragment = getSelectedProjectFragment();
  const selectedProseId = selectedFragment?.type === "prose" ? String(selectedFragment.id || "").trim() : "";
  chainEl.innerHTML = entries.length
    ? entries.map((entry) => `
      <div class="project-fragment-chain-row">
        <div class="project-section-head">
          <strong>${escapeHtml(String(Number(entry.sectionIndex || 0) + 1))}. ${escapeHtml(entry.activeFragment?.name || entry.active || "Prose section")}</strong>
          <span class="micro">${escapeHtml(String(entry.fragments?.length || 0))} variation${Number(entry.fragments?.length || 0) === 1 ? "" : "s"}</span>
        </div>
        ${(Array.isArray(entry.fragments) ? entry.fragments : []).map((fragment) => `
          <div class="project-fragment-variation-row">
            <span class="micro">${fragment.id === entry.active ? "Active" : "Variation"} | ${escapeHtml(fragment.id || "")} | ${escapeHtml(fragment.name || "")}</span>
            ${fragment.id !== entry.active ? `<button class="secondary" type="button" data-switch-prose-variation="${escapeAttr(fragment.id)}" data-section-index="${escapeAttr(String(entry.sectionIndex || 0))}">Use</button>` : ""}
          </div>
        `).join("")}
        <div class="controls">
          <button class="secondary" type="button" data-move-prose-section="${escapeAttr(String(entry.sectionIndex || 0))}" data-move-direction="-1"${Number(entry.sectionIndex || 0) <= 0 ? " disabled" : ""}>Move up</button>
          <button class="secondary" type="button" data-move-prose-section="${escapeAttr(String(entry.sectionIndex || 0))}" data-move-direction="1"${Number(entry.sectionIndex || 0) >= entries.length - 1 ? " disabled" : ""}>Move down</button>
          ${selectedProseId && !(entry.proseFragments || []).includes(selectedProseId) ? `<button class="secondary" type="button" data-add-prose-variation="${escapeAttr(selectedProseId)}" data-section-index="${escapeAttr(String(entry.sectionIndex || 0))}">Add selected as variation</button>` : ""}
          <button class="secondary" type="button" data-remove-prose-section="${escapeAttr(String(entry.sectionIndex || 0))}">Remove section</button>
        </div>
      </div>
    `).join("")
    : `<div class="panel-subtle">No prose chain yet. Creating a prose fragment starts it automatically.</div>`;
  chainEl.querySelectorAll("[data-switch-prose-variation]").forEach((button) => {
    button.onclick = () => switchProjectProseVariation({
      sectionIndex: Number(button.dataset.sectionIndex || 0),
      fragmentId: String(button.dataset.switchProseVariation || "").trim()
    }).catch((error) => {
      projectsHintEl.textContent = `Switch failed: ${error.message}`;
    });
  });
  chainEl.querySelectorAll("[data-move-prose-section]").forEach((button) => {
    button.onclick = () => moveProjectProseSection({
      sectionIndex: Number(button.dataset.moveProseSection || 0),
      direction: Number(button.dataset.moveDirection || 0)
    }).catch((error) => {
      projectsHintEl.textContent = `Move failed: ${error.message}`;
    });
  });
  chainEl.querySelectorAll("[data-add-prose-variation]").forEach((button) => {
    button.onclick = () => addSelectedProjectProseVariation({
      sectionIndex: Number(button.dataset.sectionIndex || 0),
      fragmentId: String(button.dataset.addProseVariation || "").trim()
    }).catch((error) => {
      projectsHintEl.textContent = `Variation add failed: ${error.message}`;
    });
  });
  chainEl.querySelectorAll("[data-remove-prose-section]").forEach((button) => {
    button.onclick = () => removeProjectProseSection(Number(button.dataset.removeProseSection || 0)).catch((error) => {
      projectsHintEl.textContent = `Remove failed: ${error.message}`;
    });
  });
}

async function loadProjectFragmentsPanel(project = {}) {
  const projectName = getProjectFragmentProjectName(project);
  if (!projectName) return;
  projectFragmentsViewState.projectName = projectName;
  const params = new URLSearchParams({
    projectName,
    limit: "200"
  });
  if (projectFragmentsViewState.type) params.set("type", projectFragmentsViewState.type);
  if (projectFragmentsViewState.query) params.set("query", projectFragmentsViewState.query);
  if (projectFragmentsViewState.includeArchived) params.set("includeArchived", "true");
  const [fragmentsJson, chainJson, contextJson, validationJson] = await Promise.all([
    fetchProjectFragmentJson(`/api/projects/fragments?${params.toString()}`),
    fetchProjectFragmentJson(`/api/projects/fragment-chain?projectName=${encodeURIComponent(projectName)}`),
    fetchProjectFragmentJson(`/api/projects/fragment-context?projectName=${encodeURIComponent(projectName)}&proseLimit=12&shortlistLimit=60`),
    fetchProjectFragmentJson(`/api/projects/fragment-validation?projectName=${encodeURIComponent(projectName)}`)
  ]);
  projectFragmentsViewState.fragments = Array.isArray(fragmentsJson.fragments) ? fragmentsJson.fragments : [];
  projectFragmentsViewState.chain = chainJson.chain || null;
  projectFragmentsViewState.contextText = String(contextJson.text || "");
  projectFragmentsViewState.contextBlocks = Array.isArray(contextJson.blocks) ? contextJson.blocks : [];
  projectFragmentsViewState.validation = validationJson;
  if (projectFragmentsViewState.selectedFragmentId && !projectFragmentsViewState.fragments.some((fragment) => fragment.id === projectFragmentsViewState.selectedFragmentId)) {
    projectFragmentsViewState.selectedFragmentId = "";
  }
  if (projectFragmentsViewState.selectedFragmentId) {
    await loadSelectedFragmentDetails(projectName, projectFragmentsViewState.selectedFragmentId);
  } else {
    projectFragmentsViewState.refs = null;
    projectFragmentsViewState.versions = [];
  }
  renderProjectFragmentList();
  renderProjectFragmentEditor();
  renderProjectFragmentChain();
  renderProjectFragmentContextPreview();
  renderProjectFragmentValidation();
}

async function loadSelectedFragmentDetails(projectName = "", fragmentId = "") {
  const [refsJson, versionsJson] = await Promise.all([
    fetchProjectFragmentJson(`/api/projects/fragments/${encodeURIComponent(fragmentId)}/refs?projectName=${encodeURIComponent(projectName)}`),
    fetchProjectFragmentJson(`/api/projects/fragments/${encodeURIComponent(fragmentId)}/versions?projectName=${encodeURIComponent(projectName)}`)
  ]);
  projectFragmentsViewState.refs = refsJson;
  projectFragmentsViewState.versions = Array.isArray(versionsJson.versions) ? versionsJson.versions : [];
}

async function saveProjectFragmentEditor() {
  const form = projectsFragmentsListEl?.querySelector("[data-project-fragment-form]");
  if (!form) return;
  const projectName = projectFragmentsViewState.projectName;
  const fragmentId = String(projectFragmentsViewState.selectedFragmentId || "").trim();
  const fragment = {
    type: String(form.querySelector("[data-fragment-type]")?.value || "note").trim(),
    name: String(form.querySelector("[data-fragment-name]")?.value || "").trim(),
    description: String(form.querySelector("[data-fragment-description]")?.value || "").trim(),
    content: String(form.querySelector("[data-fragment-content]")?.value || ""),
    tags: fragmentInputToTags(form.querySelector("[data-fragment-tags]")?.value || ""),
    refs: fragmentInputToRefs(form.querySelector("[data-fragment-refs]")?.value || ""),
    sticky: form.querySelector("[data-fragment-sticky]")?.checked === true,
    placement: form.querySelector("[data-fragment-placement]")?.checked === true ? "system" : "user",
    order: Number(form.querySelector("[data-fragment-order]")?.value || 0)
  };
  if (!projectName || !fragment.name || !fragment.content.trim()) {
    projectsHintEl.textContent = "Fragment needs a name and content.";
    return;
  }
  projectsHintEl.textContent = fragmentId ? "Saving fragment..." : "Creating fragment...";
  const json = await fetchProjectFragmentJson(fragmentId
    ? `/api/projects/fragments/${encodeURIComponent(fragmentId)}`
    : "/api/projects/fragments", {
    method: fragmentId ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName, fragment })
  });
  projectFragmentsViewState.selectedFragmentId = json.fragment?.id || fragmentId;
  projectsHintEl.textContent = `Saved fragment ${projectFragmentsViewState.selectedFragmentId}.`;
  await loadProjectFragmentsPanel({ name: projectName });
  await loadProjectConfig();
}

async function archiveOrRestoreProjectFragment(action = "archive") {
  const projectName = projectFragmentsViewState.projectName;
  const fragmentId = String(projectFragmentsViewState.selectedFragmentId || "").trim();
  if (!projectName || !fragmentId) return;
  projectsHintEl.textContent = action === "restore" ? "Restoring fragment..." : "Archiving fragment...";
  await fetchProjectFragmentJson(`/api/projects/fragments/${encodeURIComponent(fragmentId)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName })
  });
  projectsHintEl.textContent = action === "restore" ? "Fragment restored." : "Fragment archived.";
  if (!projectFragmentsViewState.includeArchived && action === "archive") {
    projectFragmentsViewState.selectedFragmentId = "";
  }
  await loadProjectFragmentsPanel({ name: projectName });
  await loadProjectConfig();
}

async function revertProjectFragmentVersion(version = 0) {
  const projectName = projectFragmentsViewState.projectName;
  const fragmentId = String(projectFragmentsViewState.selectedFragmentId || "").trim();
  if (!projectName || !fragmentId || !version) return;
  await fetchProjectFragmentJson(`/api/projects/fragments/${encodeURIComponent(fragmentId)}/versions/${encodeURIComponent(String(version))}/revert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName })
  });
  projectsHintEl.textContent = `Reverted ${fragmentId} to version ${version}.`;
  await loadProjectFragmentsPanel({ name: projectName });
  await loadProjectConfig();
}

async function switchProjectProseVariation({ sectionIndex = 0, fragmentId = "" } = {}) {
  const projectName = projectFragmentsViewState.projectName;
  if (!projectName || !fragmentId) return;
  await fetchProjectFragmentJson("/api/projects/fragment-chain/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName, sectionIndex, fragmentId })
  });
  projectsHintEl.textContent = "Active prose variation updated.";
  await loadProjectFragmentsPanel({ name: projectName });
}

async function addSelectedProjectProseVariation({ sectionIndex = 0, fragmentId = "" } = {}) {
  const projectName = projectFragmentsViewState.projectName;
  if (!projectName || !fragmentId) return;
  await fetchProjectFragmentJson("/api/projects/fragment-chain/variation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName, sectionIndex, fragmentId })
  });
  projectsHintEl.textContent = "Prose variation added and made active.";
  await loadProjectFragmentsPanel({ name: projectName });
}

async function moveProjectProseSection({ sectionIndex = 0, direction = 0 } = {}) {
  const projectName = projectFragmentsViewState.projectName;
  const entries = Array.isArray(projectFragmentsViewState.chain?.entries) ? projectFragmentsViewState.chain.entries : [];
  const toIndex = Number(sectionIndex || 0) + Number(direction || 0);
  if (!projectName || toIndex < 0 || toIndex >= entries.length) return;
  await fetchProjectFragmentJson("/api/projects/fragment-chain/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName, fromIndex: Number(sectionIndex || 0), toIndex })
  });
  projectsHintEl.textContent = "Prose section moved.";
  await loadProjectFragmentsPanel({ name: projectName });
}

async function removeProjectProseSection(sectionIndex = 0) {
  const projectName = projectFragmentsViewState.projectName;
  if (!projectName) return;
  await fetchProjectFragmentJson(`/api/projects/fragment-chain/${encodeURIComponent(String(sectionIndex))}?projectName=${encodeURIComponent(projectName)}`, {
    method: "DELETE"
  });
  projectsHintEl.textContent = "Prose section removed from chain.";
  await loadProjectFragmentsPanel({ name: projectName });
}

function bindProjectFragmentsPanelEvents(project = {}) {
  const root = projectsFragmentsListEl;
  if (!(root instanceof HTMLElement)) return;
  const projectName = getProjectFragmentProjectName(project);
  const typeSelect = root.querySelector("[data-fragment-filter-type]");
  const queryInput = root.querySelector("[data-fragment-filter-query]");
  const archivedInput = root.querySelector("[data-fragment-filter-archived]");
  const refreshBtn = root.querySelector("[data-refresh-fragments]");
  const contextBtn = root.querySelector("[data-refresh-fragment-context]");
  const exportBtn = root.querySelector("[data-export-fragment-bundle]");
  const importBtn = root.querySelector("[data-import-fragment-bundle]");
  const importInput = root.querySelector("[data-import-fragment-bundle-input]");
  if (typeSelect) {
    typeSelect.value = projectFragmentsViewState.type || "";
    typeSelect.onchange = () => {
      projectFragmentsViewState.type = String(typeSelect.value || "").trim();
      projectFragmentsViewState.selectedFragmentId = "";
      loadProjectFragmentsPanel({ name: projectName }).catch((error) => {
        projectsHintEl.textContent = `Fragment load failed: ${error.message}`;
      });
    };
  }
  if (queryInput) {
    queryInput.value = projectFragmentsViewState.query || "";
    queryInput.onchange = () => {
      projectFragmentsViewState.query = String(queryInput.value || "").trim();
      projectFragmentsViewState.selectedFragmentId = "";
      loadProjectFragmentsPanel({ name: projectName }).catch((error) => {
        projectsHintEl.textContent = `Fragment search failed: ${error.message}`;
      });
    };
  }
  if (archivedInput) {
    archivedInput.checked = projectFragmentsViewState.includeArchived === true;
    archivedInput.onchange = () => {
      projectFragmentsViewState.includeArchived = archivedInput.checked === true;
      projectFragmentsViewState.selectedFragmentId = "";
      loadProjectFragmentsPanel({ name: projectName }).catch((error) => {
        projectsHintEl.textContent = `Fragment load failed: ${error.message}`;
      });
    };
  }
  if (refreshBtn) {
    refreshBtn.onclick = () => loadProjectFragmentsPanel({ name: projectName }).catch((error) => {
      projectsHintEl.textContent = `Fragment refresh failed: ${error.message}`;
    });
  }
  if (contextBtn) {
    contextBtn.onclick = () => loadProjectFragmentsPanel({ name: projectName }).catch((error) => {
      projectsHintEl.textContent = `Context refresh failed: ${error.message}`;
    });
  }
  if (exportBtn) {
    exportBtn.onclick = () => exportProjectFragmentBundle(projectName).catch((error) => {
      projectsHintEl.textContent = `Export failed: ${error.message}`;
    });
  }
  if (importBtn && importInput) {
    importBtn.onclick = () => importInput.click();
    importInput.onchange = () => importProjectFragmentBundleFromFile(importInput.files?.[0], projectName).catch((error) => {
      projectsHintEl.textContent = `Import failed: ${error.message}`;
    });
  }
}

async function exportProjectFragmentBundle(projectName = "") {
  const json = await fetchProjectFragmentJson(`/api/projects/fragment-bundle?projectName=${encodeURIComponent(projectName)}&includeArchived=${projectFragmentsViewState.includeArchived ? "true" : "false"}`);
  const blob = new Blob([JSON.stringify(json.bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName || "project"}-fragments.json`.replace(/[^a-z0-9_.-]+/gi, "-");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  projectsHintEl.textContent = "Fragment bundle exported.";
}

async function importProjectFragmentBundleFromFile(file = null, projectName = "") {
  if (!file || !projectName) return;
  const text = await file.text();
  const bundle = JSON.parse(text);
  const json = await fetchProjectFragmentJson("/api/projects/fragment-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName, bundle, preserveIds: true, overwrite: false })
  });
  projectsHintEl.textContent = `Imported ${json.importedCount || 0} fragment${Number(json.importedCount || 0) === 1 ? "" : "s"}.`;
  await loadProjectFragmentsPanel({ name: projectName });
  await loadProjectConfig();
}

function renderProjectFragmentsPanel(project = {}) {
  const fragments = project?.fragments && typeof project.fragments === "object" ? project.fragments : {};
  const projectName = getProjectFragmentProjectName(project);
  const types = getProjectFragmentTypes(project);
  const typeSummary = Object.entries(fragments.typeCounts || {})
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([type, count]) => `<span class="project-fragment-type-pill">${escapeHtml(type)} ${escapeHtml(String(count || 0))}</span>`)
    .join("");
  return `
    <div class="project-fragment-workspace">
      <div class="project-fragment-toolbar">
        <label class="stack-field"><strong>Type</strong>
          <select data-fragment-filter-type>
            <option value="">All types</option>
            ${types.map((type) => `<option value="${escapeAttr(type)}">${escapeHtml(type)}</option>`).join("")}
          </select>
        </label>
        <label class="stack-field"><strong>Search</strong><input type="search" data-fragment-filter-query placeholder="Name, tag, content" /></label>
        <div class="controls">
          <label class="setting-inline"><input type="checkbox" data-fragment-filter-archived /> Archived</label>
          <button class="secondary" type="button" data-refresh-fragments>Refresh</button>
          <button class="secondary" type="button" data-export-fragment-bundle>Export</button>
          <button class="secondary" type="button" data-import-fragment-bundle>Import</button>
          <input type="file" accept="application/json,.json" data-import-fragment-bundle-input style="display:none;" />
        </div>
      </div>
      <div class="project-fragment-type-row">
        ${typeSummary || `<span class="project-fragment-type-pill">No fragments yet</span>`}
        <span class="project-fragment-type-pill">${escapeHtml(String(fragments.stickyCount || 0))} sticky</span>
        <span class="project-fragment-type-pill">${escapeHtml(String(fragments.proseSectionCount || 0))} prose sections</span>
      </div>
      <div class="project-fragment-grid">
        <section class="brain-editor-card">
          <div class="project-section-head">
            <strong>Library</strong>
            <span class="micro" data-fragment-count>Loading...</span>
          </div>
          <div class="project-fragment-list" data-fragment-list>
            <div class="panel-subtle">Loading fragments...</div>
          </div>
        </section>
        <section class="brain-editor-card" data-fragment-editor>
          <div class="panel-subtle">Loading fragment editor...</div>
        </section>
      </div>
      <div class="project-fragment-grid">
        <section class="brain-editor-card">
          <div class="project-section-head">
            <strong>Prose Chain</strong>
            <span class="micro">${escapeHtml(projectName || "Project")}</span>
          </div>
          <div class="project-fragment-chain" data-fragment-chain>
            <div class="panel-subtle">Loading prose chain...</div>
          </div>
        </section>
        <section class="brain-editor-card">
          <div class="project-section-head">
            <strong>Context Preview</strong>
            <span class="micro" data-fragment-context-count>Loading...</span>
          </div>
          <div class="controls" style="margin-bottom:8px;"><button class="secondary" type="button" data-refresh-fragment-context>Refresh context</button></div>
          <pre class="project-fragment-context-preview" data-fragment-context>Loading context...</pre>
        </section>
      </div>
      <section class="brain-editor-card">
        <div class="project-section-head">
          <strong>Validation</strong>
          <span class="micro">Refs and prose-chain checks</span>
        </div>
        <div class="stack-list" data-fragment-validation>
          <div class="panel-subtle">Loading validation...</div>
        </div>
      </section>
    </div>
  `;
}

function getFileName(filePath = "") {
  const normalized = String(filePath || "").trim();
  if (!normalized) return "";
  const trimmed = normalized.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed;
}

function formatProjectStageLabel(stage = "") {
  const normalized = String(stage || "").trim().toLowerCase();
  if (normalized === "active") return "Working";
  if (normalized === "workspace") return "In workspace";
  if (normalized === "completed") return "Ready output";
  if (normalized === "archived") return "Archived";
  if (normalized === "intake") return "In intake";
  return "History";
}

function formatProjectDuration(ms = 0) {
  const duration = Math.max(0, Number(ms || 0));
  if (!duration) return "Unknown";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (duration < hour) {
    return `${Math.max(1, Math.round(duration / minute))}m`;
  }
  if (duration < day) {
    const hours = duration / hour;
    return `${hours.toFixed(hours >= 10 ? 0 : 1).replace(/\.0$/, "")}h`;
  }
  const days = duration / day;
  return `${days.toFixed(days >= 10 ? 0 : 1).replace(/\.0$/, "")}d`;
}

function projectStagePillClass(stage = "") {
  const normalized = String(stage || "").trim().toLowerCase();
  if (["active", "workspace", "completed"].includes(normalized)) return "on";
  if (normalized === "archived") return "";
  return "off";
}

function renderProjectMiniStat(label, value, hint = "", tone = "") {
  return `
    <div class="project-mini-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || 0))}</strong>
      ${hint ? `<div class="micro">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;
}

function renderProjectAssessmentPanel(assessment = {}, { roleReports = [], deferredRoleReports = [], activeRoles = [] } = {}) {
  const phaseLabel = String(assessment?.phaseLabel || "").trim();
  const workstreamLabel = String(assessment?.workstreamLabel || "").trim();
  const currentPriority = String(assessment?.currentPriority || "").trim();
  const deferredPosture = String(assessment?.deferredPosture || "").trim()
    || (assessment?.deferLatePassAudits
      ? "Late-pass audit roles are being held until the project reaches a quality or finalization pass."
      : "Late-pass audit roles can activate when the current objective clearly calls for them.");
  const workingRoleCount = roleReports.length || Math.max(0, Number(activeRoles?.length || 0));
  const closedRoleCount = roleReports.filter((entry) => String(entry?.status || "").trim().toLowerCase() === "completed").length;
  const deferredRoleCount = deferredRoleReports.length;
  const sourceLabel = String(assessment?.source || "").trim().toLowerCase() === "snapshot"
    ? "Saved role-board snapshot"
    : "Current project scan";
  if (!phaseLabel && !workstreamLabel && !currentPriority && !deferredPosture && !workingRoleCount && !deferredRoleCount) {
    return "";
  }
  return `
    <section class="project-assessment-card">
      <div class="project-section-head">
        <strong>Assessment</strong>
        <span class="micro">${escapeHtml(sourceLabel)}</span>
      </div>
      <div class="project-assessment-pills">
        ${phaseLabel ? `<span class="summary-pill">${escapeHtml(phaseLabel)}</span>` : ""}
        ${workstreamLabel ? `<span class="summary-pill on">${escapeHtml(workstreamLabel)}</span>` : ""}
        <span class="summary-pill ${assessment?.deferLatePassAudits ? "off" : "on"}">${escapeHtml(assessment?.deferLatePassAudits ? "Late-pass deferred" : "Late-pass ready")}</span>
      </div>
      <div class="project-assessment-stat-grid">
        ${renderProjectMiniStat("Working roles", workingRoleCount, workingRoleCount ? `${workingRoleCount} visible now` : "No active role lane yet")}
        ${renderProjectMiniStat("Deferred roles", deferredRoleCount, deferredRoleCount ? "Held until the project matures" : "No deferred specialists right now", deferredRoleCount ? "tone-warn" : "tone-ok")}
        ${renderProjectMiniStat("Closed roles", closedRoleCount, closedRoleCount ? "Finished role passes" : "No finished role passes yet", closedRoleCount ? "tone-ok" : "")}
      </div>
      ${currentPriority ? `
        <div class="project-assessment-callout">
          <strong>Current priority</strong>
          <div class="micro">${escapeHtml(currentPriority)}</div>
        </div>
      ` : ""}
      ${deferredPosture ? `
        <div class="project-assessment-callout ${assessment?.deferLatePassAudits ? "deferred" : "ready"}">
          <strong>Role posture</strong>
          <div class="micro">${escapeHtml(deferredPosture)}</div>
        </div>
      ` : ""}
    </section>
  `;
}

function renderProjectChecklistPanel(title, bucket = {}, { objective = "", emptyText = "No items recorded.", filePath = "" } = {}) {
  const checked = Array.isArray(bucket?.checked) ? bucket.checked : [];
  const unchecked = Array.isArray(bucket?.unchecked) ? bucket.unchecked : [];
  const checkedCount = Number(bucket?.checkedCount || checked.length);
  const uncheckedCount = Number(bucket?.uncheckedCount || unchecked.length);
  const total = checkedCount + uncheckedCount;
  const removable = Boolean(filePath);
  const renderItem = (item, cls) => removable
    ? `<div class="project-check-item ${cls}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;">
        <span>${escapeHtml(item)}</span>
        <button type="button" class="secondary micro" style="flex-shrink:0;padding:1px 5px;" data-remove-checklist-item="${escapeAttr(item)}" data-checklist-file-path="${escapeAttr(filePath)}" title="Remove item">x</button>
       </div>`
    : `<div class="project-check-item ${cls}">${escapeHtml(item)}</div>`;
  const previewLines = [
    ...unchecked.slice(0, 3).map((item) => renderItem(item, "open")),
    ...checked.slice(0, 2).map((item) => renderItem(item, "done"))
  ];
  return `
    <div class="project-checklist-panel">
      <div class="project-checklist-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="summary-pill ${uncheckedCount ? "" : "on"}">${escapeHtml(total ? `${checkedCount}/${total}` : "0/0")}</span>
      </div>
      <div class="micro">${escapeHtml(uncheckedCount ? `${uncheckedCount} open` : "Nothing open")}${checkedCount ? ` | ${escapeHtml(`${checkedCount} done`)}` : ""}</div>
      ${objective ? `<div class="project-directive-objective">${escapeHtml(objective)}</div>` : ""}
      ${previewLines.length ? previewLines.join("") : `<div class="panel-subtle">${escapeHtml(emptyText)}</div>`}
    </div>
  `;
}

function renderProjectTaskLine(task = {}, label = "Task") {
  const meta = [
    String(task?.requestedBrainLabel || "").trim(),
    String(task?.status || "").trim().replaceAll("_", " "),
    task?.updatedAt ? formatDateTime(task.updatedAt) : ""
  ].filter(Boolean).join(" | ");
  const roleMeta = String(task?.roleName || "").trim()
    ? `Role: ${String(task.roleName || "").trim()}${task?.roleReason ? ` | ${String(task.roleReason || "").trim()}` : ""}`
    : "";
  return `
    <div class="project-activity-item">
      <div class="history-meta">
        <span>${escapeHtml(String(task?.codename || task?.id || label).trim() || label)}</span>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="history-body">${escapeHtml(String(task?.focus || "").trim() || "No focus recorded.")}</div>
      ${roleMeta ? `<div class="micro">${escapeHtml(roleMeta)}</div>` : ""}
      ${task?.summary ? `<div class="micro">${escapeHtml(String(task.summary || "").trim())}</div>` : ""}
    </div>
  `;
}

function renderProjectJobLine(job = {}) {
  const meta = [
    String(job?.latestRequestedBrainLabel || "").trim(),
    String(job?.finalStatus || "").trim().replaceAll("_", " "),
    job?.updatedAt ? formatDateTime(job.updatedAt) : ""
  ].filter(Boolean).join(" | ");
  const extra = [
    Number(job?.attemptCount || 0) > 1 ? `${Number(job.attemptCount || 0)} attempts` : "1 attempt",
    String(job?.finalFailureClassification || "").trim() && String(job?.finalFailureClassification || "").trim() !== "unknown"
      ? String(job.finalFailureClassification).trim()
      : ""
  ].filter(Boolean).join(" | ");
  const roleMeta = String(job?.roleName || "").trim()
    ? `Role: ${String(job.roleName || "").trim()}${job?.roleReason ? ` | ${String(job.roleReason || "").trim()}` : ""}`
    : "";
  return `
    <div class="project-activity-item">
      <div class="history-meta">
        <span>${escapeHtml(String(job?.latestCodename || job?.latestTaskId || "Job").trim() || "Job")}</span>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="history-body">${escapeHtml(String(job?.focus || "").trim() || "No objective recorded.")}</div>
      ${roleMeta ? `<div class="micro">${escapeHtml(roleMeta)}</div>` : ""}
      ${extra ? `<div class="micro">${escapeHtml(extra)}</div>` : ""}
    </div>
  `;
}

function renderProjectRoleReportCard(role = {}, { roleTaskPath = "" } = {}) {
  const unchecked = Array.isArray(role?.unchecked) ? role.unchecked : [];
  const checked = Array.isArray(role?.checked) ? role.checked : [];
  const recommended = Array.isArray(role?.recommended) ? role.recommended : [];
  const status = String(role?.status || "").trim().toLowerCase();
  const pillClass = status === "completed" ? "on" : status === "active" ? "" : "off";
  const statusLabel = status === "completed"
    ? "Closed"
    : status === "active"
      ? "Working"
      : status === "suggested"
        ? "Deferred"
        : "Planned";
  const preview = unchecked.length ? unchecked : checked.length ? checked : recommended;
  const roleName = String(role?.name || "Role").trim() || "Role";
  const previewClass = unchecked.length
    ? "open"
    : checked.length
      ? "done"
      : status === "suggested"
        ? "suggested"
        : "";
  const canRemoveRole = Boolean(roleTaskPath) && status !== "suggested";
  return `
    <div class="project-role-card">
      <div class="project-role-head">
        <strong>${escapeHtml(roleName)}</strong>
        <div style="display:flex;gap:4px;align-items:center;">
          <span class="summary-pill ${pillClass}">${escapeHtml(statusLabel)}</span>
          ${canRemoveRole ? `<button type="button" class="secondary micro" style="padding:1px 5px;" data-remove-project-role="${escapeAttr(roleName)}" data-role-task-path="${escapeAttr(roleTaskPath)}" title="Remove role">x</button>` : ""}
        </div>
      </div>
      <div class="micro">${escapeHtml(`${Number(role?.uncheckedCount || unchecked.length)} open | ${Number(role?.checkedCount || checked.length)} done`)}</div>
      ${role?.reason ? `<div class="project-role-reason">${escapeHtml(String(role.reason || "").trim())}</div>` : ""}
      ${preview.length
        ? preview.slice(0, 3).map((item) => `<div class="project-check-item ${previewClass}">${escapeHtml(String(item || "").trim())}</div>`).join("")
        : `<div class="panel-subtle">${escapeHtml(String(role?.playbook || "No role summary yet.").trim() || "No role summary yet.")}</div>`}
    </div>
  `;
}

function renderProjectArtifactLine(entry = {}, label = "History") {
  const meta = [
    label,
    entry?.occurredAt ? formatDateTime(entry.occurredAt) : "Unknown time"
  ].filter(Boolean).join(" | ");
  const extra = [
    String(entry?.reason || "").trim(),
    String(entry?.label || "").trim()
  ].filter(Boolean).join(" | ");
  const pathLabel = String(entry?.path || "").trim() ? getFileName(String(entry.path || "").trim()) : "Path unavailable.";
  return `
    <div class="project-activity-item">
      <div class="history-meta"><span>${escapeHtml(meta)}</span></div>
      <div class="history-body">${escapeHtml(pathLabel)}</div>
      ${extra ? `<div class="micro">${escapeHtml(extra)}</div>` : ""}
    </div>
  `;
}

function getProjectProgressStats(project = {}) {
  const checklist = project?.checklist && typeof project.checklist === "object" ? project.checklist : {};
  const totals = checklist?.totals && typeof checklist.totals === "object" ? checklist.totals : {};
  const recentJobs = Array.isArray(project?.recentJobs) ? project.recentJobs : [];
  const activeTasks = Array.isArray(project?.activeTasks) ? project.activeTasks : [];
  const waitingTasks = Array.isArray(project?.waitingTasks) ? project.waitingTasks : [];
  const completedItems = Number(totals.completedItems || 0);
  const totalItems = Number(totals.totalItems || 0);
  const openItems = Math.max(0, Number(totals.openItems || totalItems - completedItems || 0));
  const percent = totalItems > 0
    ? Math.max(0, Math.min(100, Math.round((completedItems / totalItems) * 100)))
    : String(project?.currentStage || "").toLowerCase() === "completed"
      ? 100
      : 0;
  const completedJobs = recentJobs.filter((job) => ["completed", "closed", "done"].includes(String(job?.finalStatus || "").trim()));
  const failedJobs = recentJobs.filter((job) => String(job?.finalStatus || "").trim() === "failed");
  const durations = completedJobs
    .map((job) => Number(job?.updatedAt || 0) - Number(job?.startedAt || 0))
    .filter((duration) => duration > 0);
  const averagePackageMs = durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : 0;
  const remainingWorkUnits = openItems || (activeTasks.length || waitingTasks.length ? 1 : 0);
  const estimateMs = averagePackageMs && remainingWorkUnits
    ? averagePackageMs * remainingWorkUnits
    : 0;
  return {
    activeCount: activeTasks.length,
    averagePackageMs,
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
    openItems,
    percent,
    remainingWorkUnits,
    totalItems,
    waitingCount: waitingTasks.length,
    estimateLabel: estimateMs ? `~${formatProjectDuration(estimateMs)}` : "Collecting baseline"
  };
}

function normalizeProjectWorkText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function projectWorkTokens(value = "") {
  const stop = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "project", "task", "work", "make", "add", "fix", "update", "review"]);
  return normalizeProjectWorkText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stop.has(token));
}

function scoreProjectWorkMatch(left = "", right = "") {
  const normalizedLeft = normalizeProjectWorkText(left);
  const normalizedRight = normalizeProjectWorkText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 1;
  const leftTokens = new Set(projectWorkTokens(normalizedLeft));
  const rightTokens = new Set(projectWorkTokens(normalizedRight));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function buildProjectWorkRefs(project = {}) {
  const refs = [];
  const addRef = (source = {}, kind = "task", status = "") => {
    const title = String(source?.codename || source?.latestCodename || source?.id || source?.latestTaskId || kind).trim();
    const focus = String(source?.focus || "").trim();
    const role = String(source?.roleName || source?.projectWorkRoleName || "").trim();
    refs.push({
      id: String(source?.id || source?.latestTaskId || source?.projectWorkKey || `${kind}-${refs.length}`).trim(),
      title: title || kind,
      kind,
      status: String(status || source?.status || source?.finalStatus || "").trim(),
      focus,
      role,
      summary: String(source?.summary || source?.finalFailureClassification || "").trim(),
      attemptCount: Number(source?.attemptCount || 0),
      updatedAt: Number(source?.updatedAt || 0),
      matchText: [focus, role, title].filter(Boolean).join(" ")
    });
  };
  for (const task of Array.isArray(project?.activeTasks) ? project.activeTasks : []) addRef(task, "task", "in_progress");
  for (const task of Array.isArray(project?.waitingTasks) ? project.waitingTasks : []) addRef(task, "task", "waiting_for_user");
  for (const job of Array.isArray(project?.recentJobs) ? project.recentJobs : []) addRef(job, "job", String(job?.finalStatus || ""));
  return refs;
}

function buildProjectChecklistWorkItems(project = {}, refs = []) {
  const checklist = project?.checklist && typeof project.checklist === "object" ? project.checklist : {};
  const roleReports = Array.isArray(project?.roleReports) ? project.roleReports : [];
  const items = [];
  const usedRefIds = new Set();
  const addItem = ({ title = "", lane = "Todo", done = false, type = "checklist", detail = "" } = {}) => {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) return;
    const scoredRefs = refs
      .map((ref) => ({
        ref,
        score: scoreProjectWorkMatch(`${normalizedTitle} ${lane} ${detail}`, ref.matchText)
      }))
      .filter((entry) => entry.score >= 0.22)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((entry) => entry.ref);
    scoredRefs.forEach((ref) => usedRefIds.add(ref.id));
    items.push({
      id: `${type}:${lane}:${normalizedProjectWorkId(normalizedTitle)}:${items.length}`,
      title: normalizedTitle,
      lane,
      type,
      done,
      detail,
      refs: scoredRefs
    });
  };
  const addBucket = (bucket = {}, lane = "Todo") => {
    for (const item of Array.isArray(bucket?.unchecked) ? bucket.unchecked : []) addItem({ title: item, lane, done: false });
    for (const item of Array.isArray(bucket?.checked) ? bucket.checked : []) addItem({ title: item, lane, done: true });
  };
  addBucket(checklist.todo, "Todo");
  addBucket(checklist.roles, "Role task");
  if (String(checklist?.directive?.objective || "").trim()) {
    addItem({
      title: String(checklist.directive.objective || "").trim(),
      lane: "Directive",
      done: checklist?.directive?.completed === true,
      type: "directive"
    });
  }
  for (const role of roleReports) {
    const roleName = String(role?.name || "Role").trim();
    for (const item of Array.isArray(role?.unchecked) ? role.unchecked : []) {
      addItem({ title: item, lane: roleName, done: false, type: "role", detail: roleName });
    }
    for (const item of Array.isArray(role?.checked) ? role.checked : []) {
      addItem({ title: item, lane: roleName, done: true, type: "role", detail: roleName });
    }
  }
  for (const ref of refs) {
    if (usedRefIds.has(ref.id)) continue;
    items.push({
      id: `orphan:${ref.id}`,
      title: ref.focus || ref.title,
      lane: ref.kind === "job" ? "Spawned job" : "Spawned task",
      type: "spawned",
      done: ["completed", "closed", "done"].includes(String(ref.status || "").trim()),
      detail: ref.role,
      refs: [ref]
    });
  }
  return items;
}

function normalizedProjectWorkId(value = "") {
  return normalizeProjectWorkText(value).replace(/\s+/g, "-").slice(0, 80) || "item";
}

function getProjectWorkItemColumn(item = {}) {
  const refs = Array.isArray(item.refs) ? item.refs : [];
  if (refs.some((ref) => String(ref.status || "").trim() === "waiting_for_user")) return "blocked";
  if (refs.some((ref) => ["queued", "in_progress"].includes(String(ref.status || "").trim()))) return "active";
  if (refs.some((ref) => String(ref.status || "").trim() === "failed")) return "review";
  if (item.done) return "done";
  if (refs.some((ref) => ["completed", "closed", "done"].includes(String(ref.status || "").trim()))) return "review";
  return "backlog";
}

function renderProjectWorkItemCard(item = {}) {
  const refs = Array.isArray(item.refs) ? item.refs : [];
  const column = getProjectWorkItemColumn(item);
  const statusLabel = column === "done"
    ? "done"
    : column === "active"
      ? "active"
      : column === "blocked"
        ? "blocked"
        : column === "review"
          ? "review"
          : "open";
  return `
    <article class="project-progress-card ${column === "done" ? "done" : ""}">
      <div class="project-progress-head">
        <strong>${escapeHtml(item.title || "Work item")}</strong>
        <span class="summary-pill ${column === "done" ? "on" : column === "blocked" ? "off" : ""}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="micro">${escapeHtml([item.lane, item.detail].filter(Boolean).join(" | ") || "Checklist item")}</div>
      ${refs.length ? `
        <div class="project-progress-ref-list">
          ${refs.map((ref) => `
            <div class="project-progress-ref">
              <div class="history-meta">
                <span>${escapeHtml(ref.title || ref.kind || "work")}</span>
                <span>${escapeHtml(String(ref.status || "").replaceAll("_", " ") || "unknown")}</span>
              </div>
              ${ref.focus ? `<div>${escapeHtml(ref.focus)}</div>` : ""}
              <div class="micro">${escapeHtml([
                ref.kind,
                ref.role ? `Role: ${ref.role}` : "",
                ref.attemptCount ? `${ref.attemptCount} attempt${ref.attemptCount === 1 ? "" : "s"}` : "",
                ref.updatedAt ? formatDateTime(ref.updatedAt) : ""
              ].filter(Boolean).join(" | "))}</div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="panel-subtle">No spawned project-cycle task attached yet.</div>`}
    </article>
  `;
}

function renderProjectTimelineItem(item = {}) {
  return `
    <div class="project-timeline-item">
      <div class="project-timeline-dot"></div>
      <div>
        <div class="history-meta"><span>${escapeHtml(item.when ? formatDateTime(item.when) : "Unknown time")}</span><span>${escapeHtml(item.kind || "Event")}</span></div>
        <div class="history-body">${escapeHtml(item.title || "Project event")}</div>
        ${item.detail ? `<div class="micro">${escapeHtml(item.detail)}</div>` : ""}
      </div>
    </div>
  `;
}

function buildSingleProjectTimeline(project = {}) {
  const items = [];
  const name = String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)";
  const source = project?.source || {};
  const workspace = project?.workspace || {};
  if (source?.present && source.modifiedAt) {
    items.push({ when: Number(source.modifiedAt || 0), kind: "Intake", title: name, detail: "Source project changed." });
  }
  if (workspace?.present && workspace.modifiedAt) {
    items.push({ when: Number(workspace.modifiedAt || 0), kind: "Workspace", title: name, detail: workspace.activeTaskCount ? `${workspace.activeTaskCount} active project-cycle task(s).` : "Workspace project changed." });
  }
  for (const task of [...(Array.isArray(project.activeTasks) ? project.activeTasks : []), ...(Array.isArray(project.waitingTasks) ? project.waitingTasks : [])]) {
    items.push({
      when: Number(task.updatedAt || task.createdAt || 0),
      kind: String(task.status || "").replaceAll("_", " ") || "Task",
      title: String(task.codename || task.id || "task").trim(),
      detail: String(task.focus || "").trim()
    });
  }
  for (const job of (Array.isArray(project.recentJobs) ? project.recentJobs : []).slice(0, 8)) {
    items.push({
      when: Number(job.updatedAt || 0),
      kind: String(job.finalStatus || "").replaceAll("_", " ") || "Job",
      title: String(job.latestCodename || job.latestTaskId || "job").trim(),
      detail: String(job.focus || "").trim()
    });
  }
  for (const ready of (Array.isArray(project?.history?.readyExports) ? project.history.readyExports : []).slice(0, 2)) {
    items.push({ when: Number(ready.occurredAt || 0), kind: "Ready", title: name, detail: getFileName(String(ready.path || "")) || "Ready output recorded." });
  }
  return items
    .filter((item) => Number(item.when || 0) > 0)
    .sort((left, right) => Number(right.when || 0) - Number(left.when || 0))
    .slice(0, 16);
}

function renderProjectWorkBoard(project = {}, summary = {}) {
  const projectName = String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)";
  const refs = buildProjectWorkRefs(project);
  const items = buildProjectChecklistWorkItems(project, refs);
  const stats = getProjectProgressStats(project);
  const boardColumns = [
    { id: "backlog", title: "Backlog" },
    { id: "active", title: "Active" },
    { id: "blocked", title: "Blocked" },
    { id: "review", title: "Review" },
    { id: "done", title: "Done" }
  ];
  const timeline = buildSingleProjectTimeline(project);
  const completedItemCount = items.filter((item) => getProjectWorkItemColumn(item) === "done").length;
  return `
    <div class="project-progress-dashboard">
      <div class="project-progress-summary">
        ${renderProjectMiniStat("Checklist progress", `${stats.percent}%`, stats.totalItems ? `${stats.openItems} open of ${stats.totalItems}` : "No checklist baseline")}
        ${renderProjectMiniStat("Spawned work", refs.length, `${stats.activeCount} active | ${stats.waitingCount} waiting`, stats.waitingCount ? "tone-warn" : "")}
        ${renderProjectMiniStat("Completed items", completedItemCount, `${items.length} visible work card${items.length === 1 ? "" : "s"}`, completedItemCount ? "tone-ok" : "")}
        ${renderProjectMiniStat("ETA", stats.estimateLabel, stats.averagePackageMs ? `Avg package ${formatProjectDuration(stats.averagePackageMs)}` : "Needs completed timing samples")}
      </div>
      <section class="project-timeline-panel">
        <div class="project-section-head">
          <strong>${escapeHtml(projectName)}</strong>
          <span class="summary-pill ${projectStagePillClass(project?.currentStage)}">${escapeHtml(formatProjectStageLabel(project?.currentStage))}</span>
        </div>
        <div class="project-progress-meter" aria-label="${escapeAttr(`${stats.percent}% complete`)}">
          <span style="width:${escapeAttr(String(stats.percent))}%"></span>
        </div>
        <div class="micro">${escapeHtml(stats.totalItems ? `${stats.openItems} open checklist item${stats.openItems === 1 ? "" : "s"}` : "This project has no parsed checklist items yet.")}</div>
      </section>
      <div class="project-kanban-board">
        ${boardColumns.map((column) => {
          const columnItems = items.filter((item) => getProjectWorkItemColumn(item) === column.id);
          return `
            <section class="project-kanban-column">
              <div class="project-kanban-head">
                <strong>${escapeHtml(column.title)}</strong>
                <span class="summary-pill">${escapeHtml(String(columnItems.length))}</span>
              </div>
              <div class="project-kanban-list">
                ${columnItems.length
                  ? columnItems.map((item) => renderProjectWorkItemCard(item)).join("")
                  : `<div class="panel-subtle">No items here.</div>`}
              </div>
            </section>
          `;
        }).join("")}
      </div>
      <section class="project-timeline-panel">
        <div class="project-section-head">
          <strong>Recent Movement</strong>
          <span class="micro">${escapeHtml(timeline.length ? `${timeline.length} latest events` : "No dated project events yet")}</span>
        </div>
        <div class="project-timeline-list">
          ${timeline.length
            ? timeline.map((item) => renderProjectTimelineItem(item)).join("")
            : `<div class="panel-subtle">Project timeline will populate as tasks, imports, workspace changes, and exports are recorded.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderCompletedProjectJobCard(entry = {}) {
  const job = entry?.job && typeof entry.job === "object" ? entry.job : null;
  const projectName = String(entry?.projectName || "(unnamed project)").trim() || "(unnamed project)";
  const sourceName = String(entry?.sourceName || "").trim();
  const statusLabel = job?.finalStatus
    ? String(job.finalStatus || "").trim().replaceAll("_", " ")
    : "exported";
  const when = job?.updatedAt
    ? formatDateTime(job.updatedAt)
    : (entry?.outputAt ? formatDateTime(entry.outputAt) : "Unknown time");
  const focus = String(job?.focus || "").trim() || "Exported project snapshot";
  const detailBits = [
    sourceName && sourceName !== projectName ? `Source: ${sourceName}` : "",
    String(entry?.stage || "").trim() ? `Panel: ${formatProjectStageLabel(entry.stage)}` : "",
    entry?.outputPath ? "Ready output recorded" : ""
  ].filter(Boolean).join(" | ");
  const attemptBits = job
    ? [
      Number(job?.attemptCount || 0) > 1 ? `${Number(job.attemptCount || 0)} attempts` : "1 attempt",
      String(job?.finalFailureClassification || "").trim() && String(job?.finalFailureClassification || "").trim() !== "unknown"
        ? String(job.finalFailureClassification).trim()
        : ""
    ].filter(Boolean).join(" | ")
    : "";
  return `
    <article class="project-overview-card">
      <div class="project-overview-head">
        <div class="project-overview-title">
          <div class="project-overview-title-row">
            <h4>${escapeHtml(projectName)}</h4>
            <span class="summary-pill on">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="panel-subtle">${escapeHtml(when)}</div>
          ${detailBits ? `<div class="micro">${escapeHtml(detailBits)}</div>` : ""}
        </div>
      </div>
      <div class="project-overview-grid">
        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Completed Work</strong>
          </div>
          <div class="project-activity-list">
            <div class="project-activity-item">
              <div class="history-body">${escapeHtml(focus)}</div>
              ${job?.roleName ? `<div class="micro">${escapeHtml(`Role: ${String(job.roleName || "").trim()}${job?.roleReason ? ` | ${String(job.roleReason || "").trim()}` : ""}`)}</div>` : ""}
              ${attemptBits ? `<div class="micro">${escapeHtml(attemptBits)}</div>` : ""}
            </div>
          </div>
        </section>
        <section class="project-overview-section">
          <div class="project-section-head">
            <strong>Output</strong>
          </div>
          <div class="project-activity-list">
            ${entry?.outputPath
              ? `<div class="project-activity-item"><div class="history-body">${escapeHtml(getFileName(String(entry.outputPath || "").trim()))}</div></div>`
              : `<div class="panel-subtle">No ready-output path recorded for this completed job.</div>`}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderProjectOverviewCard(project = {}) {
  const source = project?.source && typeof project.source === "object" ? project.source : {};
  const workspace = project?.workspace && typeof project.workspace === "object" ? project.workspace : {};
  const checklist = project?.checklist && typeof project.checklist === "object" ? project.checklist : {};
  const checklistTotals = checklist?.totals && typeof checklist.totals === "object" ? checklist.totals : {};
  const history = project?.history && typeof project.history === "object" ? project.history : {};
  const readyExports = Array.isArray(history.readyExports) ? history.readyExports : [];
  const archivedExports = Array.isArray(history.archivedExports) ? history.archivedExports : [];
  const backups = Array.isArray(history.backups) ? history.backups : [];
  const activeTasks = Array.isArray(project.activeTasks) ? project.activeTasks : [];
  const waitingTasks = Array.isArray(project.waitingTasks) ? project.waitingTasks : [];
  const recentJobs = Array.isArray(project.recentJobs) ? project.recentJobs : [];
  const roleReports = Array.isArray(project.roleReports) ? project.roleReports : [];
  const deferredRoleReports = Array.isArray(project.deferredRoleReports) ? project.deferredRoleReports : [];
  const assessment = project?.assessment && typeof project.assessment === "object" ? project.assessment : {};
  const projectAssessmentHtml = renderProjectAssessmentPanel(assessment, {
    roleReports,
    deferredRoleReports,
    activeRoles: Array.isArray(project.activeRoles) ? project.activeRoles : []
  });
  const settledJobs = recentJobs.filter((entry) => !["queued", "in_progress", "waiting_for_user"].includes(String(entry?.finalStatus || "").trim()));
  const latestReady = readyExports[0] || null;
  const latestArchive = archivedExports[0] || null;
  const latestBackup = backups[0] || null;
  const currentLocation = workspace?.present
    ? `Workspace: ${getFileName(workspace.path) || "(unnamed workspace)"}`
    : source?.present
      ? `Intake: ${getFileName(source.path) || "(unnamed intake)"}`
      : latestReady?.path
        ? `Latest ready output: ${getFileName(latestReady.path)}`
        : latestArchive?.path
          ? `Latest archive: ${getFileName(latestArchive.path)}`
          : latestBackup?.path
            ? `Latest backup: ${getFileName(latestBackup.path)}`
            : "No tracked location yet.";
  const intakeState = source?.present
    ? `Available${source.modifiedAt ? ` | ${formatDateTime(source.modifiedAt)}` : ""}`
    : String(project?.sourceName || "").trim()
      ? `Seen as ${String(project.sourceName).trim()}`
      : "Not seen";
  const workspaceState = workspace?.present
    ? `${workspace.activeTaskCount ? `${workspace.activeTaskCount} active` : "Idle"}${workspace.waitingTaskCount ? ` | ${workspace.waitingTaskCount} waiting` : ""}`
    : "Not in workspace";
  const outputState = latestReady
    ? `Ready | ${formatDateTime(latestReady.occurredAt)}`
    : latestArchive
      ? `Archived | ${formatDateTime(latestArchive.occurredAt)}`
      : "Not exported";
  const historyState = backups.length
    ? `${backups.length} backup${backups.length === 1 ? "" : "s"}${latestBackup?.occurredAt ? ` | ${formatDateTime(latestBackup.occurredAt)}` : ""}`
    : "No backups";
  const outputHistoryHtml = [
    ...readyExports.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Ready export")),
    ...archivedExports.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Archive")),
    ...backups.slice(0, 2).map((entry) => renderProjectArtifactLine(entry, "Backup"))
  ].join("");

  const projectChecklistHtml = `
    <div class="project-checklist-panel">
      <div class="project-section-head">
        <strong>Checklist Status</strong>
        <span class="micro">${escapeHtml(checklistTotals?.totalItems ? `${checklistTotals.completedItems || 0}/${checklistTotals.totalItems} requirements closed` : "No tracked requirements yet")}</span>
      </div>
      <div class="project-checklist-grid">
        ${renderProjectChecklistPanel("Todo", checklist?.todo, { emptyText: "No PROJECT-TODO.md items yet.", filePath: String(checklist?.todoPath || "") })}
        ${renderProjectChecklistPanel("Roles", checklist?.roles, { emptyText: "No role-board items yet.", filePath: String(checklist?.roleTaskPath || "") })}
        ${renderProjectChecklistPanel("Directive", checklist?.directive, {
          objective: String(checklist?.directive?.objective || "").trim(),
          emptyText: "No directive checklist detected."
        })}
      </div>
    </div>
  `;

  const overviewPanelHtml = `
    <div id="projectsOverviewOverviewPanel" class="projects-overview-subtab-panel active">
      <article class="project-overview-card">
        <div class="project-overview-head">
          <div class="project-overview-title">
            <div class="project-overview-title-row">
              <h4>${escapeHtml(String(project?.name || project?.sourceName || "(unnamed project)").trim() || "(unnamed project)")}</h4>
              <span class="summary-pill ${projectStagePillClass(project?.currentStage)}">${escapeHtml(formatProjectStageLabel(project?.currentStage))}</span>
            </div>
            <div class="panel-subtle">${escapeHtml(project?.sourceName && project.sourceName !== project.name ? `Source project: ${project.sourceName}` : "Project overview")}</div>
            <div class="micro" title="${escapeAttr(currentLocation)}">${escapeHtml(currentLocation)}</div>
          </div>
          <div class="project-mini-stats">
            ${renderProjectMiniStat("Open items", checklistTotals?.openItems || 0, checklistTotals?.totalItems ? `${checklistTotals.completionPercent || 0}% complete` : "No checklist")}
            ${renderProjectMiniStat("Active jobs", project?.metrics?.activeJobs || 0, activeTasks.length ? `${activeTasks.length} live` : "No live work", activeTasks.length ? "tone-warn" : "")}
            ${renderProjectMiniStat("Completed jobs", project?.metrics?.completedJobs || 0, settledJobs.length ? `${settledJobs.length} recent` : "No finished jobs", "tone-ok")}
            ${renderProjectMiniStat("Failures", project?.metrics?.failedJobs || 0, archivedExports.length ? `${archivedExports.length} archived` : "No recent failures", (project?.metrics?.failedJobs || 0) ? "tone-bad" : "")}
          </div>
        </div>

        <div class="project-stage-grid">
          <div class="project-stage-card">
            <strong>Intake</strong>
            <div class="micro">${escapeHtml(intakeState)}</div>
          </div>
          <div class="project-stage-card">
            <strong>Workspace</strong>
            <div class="micro">${escapeHtml(workspaceState)}</div>
          </div>
          <div class="project-stage-card">
            <strong>Output</strong>
            <div class="micro">${escapeHtml(outputState)}</div>
          </div>
          <div class="project-stage-card">
            <strong>History</strong>
            <div class="micro">${escapeHtml(historyState)}</div>
          </div>
        </div>

        ${projectAssessmentHtml}
        ${projectChecklistHtml}
      </article>
    </div>
  `;

  const rolesPanelHtml = `
    <div id="projectsOverviewRolesPanel" class="projects-overview-subtab-panel">
      <section class="project-overview-section">
        <div class="project-section-head">
          <strong>Working Roles</strong>
          <span class="micro">${escapeHtml(roleReports.length
            ? `${roleReports.length} active or planned role${roleReports.length === 1 ? "" : "s"}${deferredRoleReports.length ? ` | ${deferredRoleReports.length} deferred` : ""}`
            : deferredRoleReports.length
              ? `${deferredRoleReports.length} deferred role${deferredRoleReports.length === 1 ? "" : "s"}`
              : "No role report yet")}</span>
        </div>
        ${projectAssessmentHtml}
        <div class="project-role-grid">
          ${roleReports.length
            ? roleReports.map((role) => renderProjectRoleReportCard(role, { roleTaskPath: String(checklist?.roleTaskPath || "") })).join("")
            : `<div class="panel-subtle">Nova has not selected working roles for this project yet.</div>`}
        </div>
        <div class="project-section-head" style="margin-top:10px;">
          <strong>Deferred Roles</strong>
          <span class="micro">${escapeHtml(assessment?.deferredPosture || "Roles listed here are being held until the project reaches the right phase or the directive explicitly asks for them.")}</span>
        </div>
        <div class="project-role-grid">
          ${deferredRoleReports.length
            ? deferredRoleReports.map((role) => renderProjectRoleReportCard(role)).join("")
            : `<div class="panel-subtle">No deferred role suggestions are being held back right now.</div>`}
        </div>
        ${checklist?.roleTaskPath ? `
        <div class="brain-editor-card" style="margin-top:8px;">
          <div class="project-section-head"><strong>Add role</strong></div>
          <div class="stack-list" style="margin-top:4px;">
            <label class="stack-field"><strong>Role</strong>
              <select style="max-width:275px;" data-add-role-select data-role-task-path="${escapeAttr(String(checklist.roleTaskPath || ""))}">
                <option value="">Select a role...</option>
                ${[
                  "Product Manager","Project Manager","Business Analyst","Technical Architect / Solutions Architect",
                  "Story Architect","Developmental Editor","Line Editor","Continuity Editor","Character Writer","Worldbuilding Designer",
                  "UX Researcher","UX Designer","Information Architect","UI Designer","Graphic Designer","Brand Designer",
                  "Motion Designer","Content Designer","Front-End Developer","Front-End Framework Developer",
                  "Accessibility Specialist","Back-End Developer","Database Engineer","Full-Stack Developer",
                  "DevOps Engineer","Cloud Engineer","Security Engineer","Penetration Tester","QA Tester",
                  "Automation QA Engineer","Copywriter","Content Manager","SEO Specialist","Digital Marketer",
                  "Data Analyst","CRO Specialist","Web Administrator","Support Engineer","Community Manager"
                ].map((r) => `<option value="${escapeAttr(r)}"${roleReports.some((rr) => rr.name === r) ? " disabled" : ""}>${escapeHtml(r)}</option>`).join("")}
              </select>
            </label>
            <label class="stack-field"><strong>Reason</strong><input style="max-width:275px;" type="text" data-add-role-reason placeholder="Optional reason or focus" /></label>
            <div class="controls"><button type="button" data-add-role-btn data-role-task-path="${escapeAttr(String(checklist.roleTaskPath || ""))}">Add role</button></div>
          </div>
        </div>` : ""}
      </section>
    </div>
  `;

  const workPanelHtml = `
    <div id="projectsOverviewWorkPanel" class="projects-overview-subtab-panel">
      <section class="project-overview-section">
        <div class="project-section-head">
          <strong>Current Work</strong>
          <span class="micro">${escapeHtml(waitingTasks.length ? `${waitingTasks.length} waiting for Nova` : activeTasks.length ? `${activeTasks.length} active package${activeTasks.length === 1 ? "" : "s"}` : "No live work right now")}</span>
        </div>
        <div class="project-activity-list">
          ${activeTasks.length
            ? activeTasks.map((task) => renderProjectTaskLine(task, "Active task")).join("")
            : waitingTasks.length
              ? waitingTasks.map((task) => renderProjectTaskLine(task, "Waiting task")).join("")
              : `<div class="panel-subtle">No active project-cycle work is running for this project.</div>`}
        </div>
      </section>
    </div>
  `;

  const historyPanelHtml = `
    <div id="projectsOverviewHistoryPanel" class="projects-overview-subtab-panel">
      <section class="project-overview-section">
        <div class="project-section-head">
          <strong>Job History</strong>
          <span class="micro">${escapeHtml(settledJobs.length ? "Recent finished jobs for this project" : "No finished jobs recorded yet")}</span>
        </div>
        <div class="project-activity-list">
          ${settledJobs.length
            ? settledJobs.slice(0, 5).map((job) => renderProjectJobLine(job)).join("")
            : `<div class="panel-subtle">No completed or failed project jobs are recorded yet.</div>`}
        </div>
      </section>
    </div>
  `;

  const outputPanelHtml = `
    <div id="projectsOverviewOutputPanel" class="projects-overview-subtab-panel">
      <section class="project-overview-section">
        <div class="project-section-head">
          <strong>Output History</strong>
          <span class="micro">${escapeHtml(readyExports.length ? `${readyExports.length} ready export${readyExports.length === 1 ? "" : "s"}` : backups.length ? `${backups.length} backup snapshot${backups.length === 1 ? "" : "s"}` : "No output history yet")}</span>
        </div>
        <div class="project-activity-list">
          ${outputHistoryHtml || `<div class="panel-subtle">No output or backup history recorded yet.</div>`}
        </div>
      </section>
    </div>
  `;

  return `
    <div class="projects-overview-subtab-bar" role="tablist" aria-label="Project overview sections">
      <button class="projects-overview-subtab-button active" type="button" data-projects-overview-subtab-target="projectsOverviewOverviewPanel">Overview</button>
      <button class="projects-overview-subtab-button" type="button" data-projects-overview-subtab-target="projectsOverviewRolesPanel">Working Roles</button>
      <button class="projects-overview-subtab-button" type="button" data-projects-overview-subtab-target="projectsOverviewWorkPanel">Current Work</button>
      <button class="projects-overview-subtab-button" type="button" data-projects-overview-subtab-target="projectsOverviewHistoryPanel">Job History</button>
      <button class="projects-overview-subtab-button" type="button" data-projects-overview-subtab-target="projectsOverviewOutputPanel">Output History</button>
    </div>
    ${overviewPanelHtml}
    ${rolesPanelHtml}
    ${workPanelHtml}
    ${historyPanelHtml}
    ${outputPanelHtml}
  `;
}

async function loadProjectConfig() {
  projectsHintEl.textContent = "Loading project configuration...";
  try {
    const r = await fetch("/api/projects/config");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to load project configuration");
    }
    projectConfigDraft = cloneJson(j);
    renderProjectConfigEditor();
    projectsHintEl.textContent = "Project configuration loaded.";
  } catch (error) {
    projectsHintEl.textContent = `Failed to load project configuration: ${error.message}`;
    projectConfigDraft = null;
    renderProjectConfigEditor();
  }
}

async function saveProjectConfig() {
  if (!projectConfigDraft) {
    return;
  }
  saveProjectsBtn.disabled = true;
  projectsHintEl.textContent = "Saving project configuration...";
  try {
    const r = await fetch("/api/projects/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projects: projectConfigDraft.projects || {}
      })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to save project configuration");
    }
    projectConfigDraft = cloneJson(j);
    renderProjectConfigEditor();
    projectsHintEl.textContent = j.message || "Project configuration saved.";
    await loadRuntimeOptions();
    await loadCronJobs();
    await loadTaskQueue();
  } catch (error) {
    projectsHintEl.textContent = `Save failed: ${error.message}`;
  } finally {
    saveProjectsBtn.disabled = false;
  }
}

const PROJECTS_PANEL_HTML = `
  <div class="inspector">
    <div class="panel-head">
      <div>
        <h2>Projects</h2>
        <div class="panel-subtle">Project-cycle settings, workspace rotation behavior, and live project execution details.</div>
      </div>
      <div class="projects-actions">
        <button id="refreshProjectsBtn" class="secondary" type="button">Refresh projects</button>
        <button id="saveProjectsBtn" type="button">Save projects</button>
      </div>
    </div>
    <div class="hint" id="projectsHint">Loading project configuration...</div>

    <div class="projects-subtab-bar" role="tablist" aria-label="Project sections">
      <button class="projects-subtab-button active" type="button" data-projects-subtab-target="projectsOverviewPanel">Projects</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsProgressPanel">Progress</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsFragmentsPanel">Fragments</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsCompletedPanel">Completed</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsStatePanel">State</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsSettingsPanel">Settings</button>
      <button class="projects-subtab-button" type="button" data-projects-subtab-target="projectsPoliciesPanel">Imports / Policies</button>
    </div>

    <section id="projectsOverviewPanel" class="projects-subtab-panel active">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Projects</h3>
            <div class="panel-subtle">Complete project overviews with checklist status, role report cards, active work, and history.</div>
          </div>
        </div>
        <div class="projects-overview-controls">
          <label class="stack-field">
            <strong>Project</strong>
            <select id="projectsOverviewSelect">
              <option value="">Loading projects...</option>
            </select>
          </label>
        </div>
        <div id="projectsOverviewList" class="projects-overview-list">Loading project overviews...</div>
      </section>
    </section>

    <section id="projectsProgressPanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Progress</h3>
            <div class="panel-subtle">Per-project checklist board with spawned project-cycle tasks, blockers, review items, and done work.</div>
          </div>
        </div>
        <div class="projects-overview-controls">
          <label class="stack-field">
            <strong>Project</strong>
            <select id="projectsProgressSelect">
              <option value="">Loading projects...</option>
            </select>
          </label>
        </div>
        <div id="projectsProgressList" class="projects-overview-list">Loading project progress...</div>
      </section>
    </section>

    <section id="projectsFragmentsPanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Fragments</h3>
            <div class="panel-subtle">Typed project memory for prose, characters, guidelines, knowledge, summaries, and notes.</div>
          </div>
        </div>
        <div class="projects-overview-controls">
          <label class="stack-field">
            <strong>Project</strong>
            <select id="projectsFragmentsSelect">
              <option value="">Loading projects...</option>
            </select>
          </label>
        </div>
        <div id="projectsFragmentsList" class="projects-overview-list">Loading project fragments...</div>
      </section>
    </section>

    <section id="projectsCompletedPanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Completed Jobs</h3>
            <div class="panel-subtle">Finished and exported project-cycle jobs remain visible here after workspace rotation continues.</div>
          </div>
        </div>
        <div id="projectsCompletedList" class="projects-overview-list">Loading completed project jobs...</div>
      </section>
    </section>

    <section id="projectsStatePanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Live State</h3>
            <div class="panel-subtle">Current workspace projects, active project tasks, and recent project failures.</div>
          </div>
        </div>
        <div id="projectsStateSummary" class="access-summary projects-summary-stack">
          <div class="panel-subtle">Loading project state...</div>
        </div>
        <div class="projects-state-grid">
          <div class="brain-editor-card">
            <strong>Workspace Projects</strong>
            <div id="projectsWorkspaceList" class="stack-list micro">Loading...</div>
          </div>
          <div class="brain-editor-card">
            <strong>Active Project Tasks</strong>
            <div id="projectsActiveTasksList" class="stack-list micro">Loading...</div>
          </div>
          <div class="brain-editor-card">
            <strong>Recent Project Failures</strong>
            <div id="projectsFailuresList" class="stack-list micro">Loading...</div>
          </div>
        </div>
      </section>
    </section>

    <section id="projectsSettingsPanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Settings</h3>
            <div class="panel-subtle">Editable operational knobs for project-cycle work and workspace rotation.</div>
          </div>
        </div>
        <div id="projectsSettingsList" class="stack-list">Loading project settings...</div>
      </section>
    </section>

    <section id="projectsPoliciesPanel" class="projects-subtab-panel">
      <section class="brain-editor-card">
        <div class="panel-head">
          <div>
            <h3>Imports / Policies</h3>
            <div class="panel-subtle">Recent imports, role playbooks, and fixed project policies.</div>
          </div>
        </div>
        <div id="projectsPoliciesList" class="stack-list micro">Loading...</div>
      </section>
    </section>
  </div>
`;

function bindProjectsPanelElements(root = null) {
  if (!(root instanceof HTMLElement)) {
    return;
  }
  projectsPluginRoot = root;
  refreshProjectsBtn = root.querySelector("#refreshProjectsBtn");
  saveProjectsBtn = root.querySelector("#saveProjectsBtn");
  projectsHintEl = root.querySelector("#projectsHint");
  projectsOverviewListEl = root.querySelector("#projectsOverviewList");
  projectsOverviewSelectEl = root.querySelector("#projectsOverviewSelect");
  projectsProgressListEl = root.querySelector("#projectsProgressList");
  projectsProgressSelectEl = root.querySelector("#projectsProgressSelect");
  projectsFragmentsListEl = root.querySelector("#projectsFragmentsList");
  projectsFragmentsSelectEl = root.querySelector("#projectsFragmentsSelect");
  projectsCompletedListEl = root.querySelector("#projectsCompletedList");
  projectsSettingsListEl = root.querySelector("#projectsSettingsList");
  projectsStateSummaryEl = root.querySelector("#projectsStateSummary");
  projectsWorkspaceListEl = root.querySelector("#projectsWorkspaceList");
  projectsActiveTasksListEl = root.querySelector("#projectsActiveTasksList");
  projectsFailuresListEl = root.querySelector("#projectsFailuresList");
  projectsPoliciesListEl = root.querySelector("#projectsPoliciesList");
  projectsSubtabButtons = Array.from(root.querySelectorAll("[data-projects-subtab-target]"));
  projectsSubtabPanels = Array.from(root.querySelectorAll(".projects-subtab-panel"));
}

function bindProjectsPanelEvents(root = null) {
  if (!(root instanceof HTMLElement) || root.dataset.projectsPluginBound === "1") {
    return;
  }
  if (refreshProjectsBtn) {
    refreshProjectsBtn.onclick = () => {
      loadProjectConfig().catch((error) => {
        if (projectsHintEl) {
          projectsHintEl.textContent = `Failed to load project configuration: ${error.message}`;
        }
      });
    };
  }
  if (saveProjectsBtn) {
    saveProjectsBtn.onclick = () => {
      saveProjectConfig().catch((error) => {
        if (projectsHintEl) {
          projectsHintEl.textContent = `Save failed: ${error.message}`;
        }
      });
    };
  }
  projectsSubtabButtons.forEach((button) => {
    button.onclick = () => activateProjectsSubtab(button.dataset.projectsSubtabTarget);
  });
  root.dataset.projectsPluginBound = "1";
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  ensureProjectsPluginStyles();
  observerAppRuntimeRef = context?.observerApp && typeof context.observerApp === "object"
    ? context.observerApp
    : {};

  if (!root.dataset.projectsPluginMounted || !root.querySelector("#projectsProgressSelect") || !root.querySelector("#projectsFragmentsSelect")) {
    root.innerHTML = PROJECTS_PANEL_HTML;
    root.dataset.projectsPluginMounted = "1";
  }

  bindProjectsPanelElements(root);
  bindProjectsPanelEvents(root);

  activateProjectsSubtab(activeProjectsSubtabId || "projectsOverviewPanel");
  if (observerAppRuntimeRef && typeof observerAppRuntimeRef === "object") {
    observerAppRuntimeRef.loadProjectsPluginPanel = () => loadProjectConfig();
    observerAppRuntimeRef.registerTaskJobTypeHandler?.("project_cycle", () => loadProjectConfig());
  }
  await loadProjectConfig();
}
