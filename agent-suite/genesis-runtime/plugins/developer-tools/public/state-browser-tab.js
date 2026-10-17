import { escapeHtml as h } from "/plugin-tab-shared.js";

let stateBrowserRoot = null;
let observerAppRef = {};
let pluginAdminFetchRef = null;
let activeScope = "workspace";
let activeFileKey = "";
let activeTaskFilePath = "";
let stateBrowserScopes = [
  { id: "workspace", label: "Sandbox workspace", group: "Live sandbox" },
  { id: "sandbox-prompt-files", label: "Sandbox prompt files", group: "Live sandbox" },
  { id: "sandbox-memory", label: "Sandbox memory", group: "Live sandbox" },
  { id: "sandbox-projects", label: "Sandbox projects", group: "Live sandbox" },
  { id: "input", label: "Observer input", group: "Sandbox boundary" },
  { id: "output", label: "Observer output", group: "Sandbox boundary" },
  { id: "queue", label: "Queue", group: "Host runtime" },
  { id: "runtime", label: "Runtime", group: "Host runtime" },
  { id: "config", label: "Config", group: "Host runtime" },
  { id: "public", label: "Public UI", group: "Host runtime" }
];

function getElements(root = stateBrowserRoot) {
  if (!(root instanceof HTMLElement)) {
    return {};
  }
  return {
    scopeSelectEl: root.querySelector("#stateBrowserScopeSelect"),
    selectedFileEl: root.querySelector("#stateBrowserSelectedFile"),
    reloadFilesBtn: root.querySelector("#stateBrowserReloadFilesBtn"),
    deleteFileBtn: root.querySelector("#stateBrowserDeleteFileBtn"),
    resetSimpleStateBtn: root.querySelector("#stateBrowserResetSimpleStateBtn"),
    hintEl: root.querySelector("#stateBrowserResetHint"),
    fileBrowserEl: root.querySelector("#stateBrowserFileBrowser"),
    taskFilesBrowserEl: root.querySelector("#stateBrowserTaskFilesBrowser"),
    fileListEl: root.querySelector("#stateBrowserFileList"),
    fileContentEl: root.querySelector("#stateBrowserFileContent"),
    taskFilesListEl: root.querySelector("#stateBrowserTaskFilesList"),
    taskFileContentEl: root.querySelector("#stateBrowserTaskFileContent")
  };
}

function ensureMarkup(root = stateBrowserRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.stateBrowserMounted === "1") {
    return;
  }
  root.innerHTML = `
    <div class="inspector">
      <div class="panel-head">
        <div>
          <h2>State lens</h2>
          <div class="panel-subtle">Browse live sandbox state, sandbox boundary mounts, and host runtime data without adding host access to Nova.</div>
        </div>
      </div>

      <div class="inspector-controls">
        <select id="stateBrowserScopeSelect"></select>
        <input id="stateBrowserSelectedFile" placeholder="Select a file below" readonly />
        <button id="stateBrowserReloadFilesBtn" class="secondary" type="button">Reload files</button>
        <button id="stateBrowserDeleteFileBtn" class="secondary" type="button" disabled>Delete file</button>
        <button id="stateBrowserResetSimpleStateBtn" class="secondary" type="button">Reset to simple start</button>
      </div>
      <div id="stateBrowserResetHint" class="hint state-reset-status">Reset Nova's internal project state, logs, and input/output folders to one simple checkbox project.</div>

      <div id="stateBrowserFileBrowser">
        <div id="stateBrowserFileList" class="file-list">Loading files...</div>
        <pre id="stateBrowserFileContent" class="file-view">Select a file to inspect.</pre>
      </div>
      <div id="stateBrowserTaskFilesBrowser" hidden>
        <div class="panel-subtle" style="margin-bottom: 10px;">Direct view of the observer queue JSON files in \`derpy-observer-task-queue/\`.</div>
        <div id="stateBrowserTaskFilesList" class="file-list">Loading task files...</div>
        <pre id="stateBrowserTaskFileContent" class="file-view">Select a task file to inspect.</pre>
      </div>
    </div>
  `;
  root.dataset.stateBrowserMounted = "1";
}

function renderScopeOptions() {
  const { scopeSelectEl } = getElements();
  if (!(scopeSelectEl instanceof HTMLSelectElement)) {
    return;
  }
  const scopes = [
    ...stateBrowserScopes,
    { id: "taskfiles", label: "Task files", group: "Task shortcuts" }
  ].filter((entry) => entry?.id && entry?.label);
  const groups = [];
  for (const scope of scopes) {
    const group = String(scope.group || "Other").trim() || "Other";
    let bucket = groups.find((entry) => entry.label === group);
    if (!bucket) {
      bucket = { label: group, scopes: [] };
      groups.push(bucket);
    }
    bucket.scopes.push(scope);
  }
  scopeSelectEl.innerHTML = groups.map((group) => `
    <optgroup label="${h(group.label)}">
      ${group.scopes.map((scope) => `<option value="${h(scope.id)}">${h(scope.label)}</option>`).join("")}
    </optgroup>
  `).join("");
  if (!scopes.some((scope) => scope.id === activeScope)) {
    activeScope = "workspace";
  }
  scopeSelectEl.value = activeScope;
}

async function loadStateBrowserManifest() {
  try {
    const response = await fetch("/api/inspect/manifest");
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load state manifest");
    }
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    if (scopes.length) {
      stateBrowserScopes = scopes
        .map((scope) => ({
          id: String(scope?.id || "").trim(),
          label: String(scope?.label || scope?.id || "").trim(),
          group: String(scope?.group || "").trim(),
          storage: String(scope?.storage || "").trim(),
          description: String(scope?.description || "").trim()
        }))
        .filter((scope) => scope.id && scope.label);
    }
  } catch {
    // Fallback scopes keep the tab usable during server upgrades.
  }
  renderScopeOptions();
}

function isTaskFilesScopeSelected() {
  return activeScope === "taskfiles";
}

function renderHint(message = "") {
  const { hintEl } = getElements();
  if (hintEl) {
    hintEl.textContent = String(message || "");
  }
}

function updateScopeView() {
  const {
    scopeSelectEl,
    selectedFileEl,
    reloadFilesBtn,
    deleteFileBtn,
    fileBrowserEl,
    taskFilesBrowserEl
  } = getElements();
  const taskFilesScope = isTaskFilesScopeSelected();
  if (scopeSelectEl) {
    scopeSelectEl.value = activeScope;
  }
  if (fileBrowserEl) {
    fileBrowserEl.hidden = taskFilesScope;
  }
  if (taskFilesBrowserEl) {
    taskFilesBrowserEl.hidden = !taskFilesScope;
  }
  if (selectedFileEl) {
    selectedFileEl.placeholder = taskFilesScope ? "Select a task file below" : "Select a file below";
    selectedFileEl.value = taskFilesScope ? (activeTaskFilePath || "") : (activeFileKey || "");
  }
  if (reloadFilesBtn) {
    reloadFilesBtn.textContent = taskFilesScope ? "Reload task files" : "Reload files";
  }
  if (deleteFileBtn) {
    deleteFileBtn.disabled = taskFilesScope || !activeFileKey;
  }
}

function buildTaskFiles() {
  if (typeof observerAppRef?.buildTaskFileEntries === "function") {
    return observerAppRef.buildTaskFileEntries();
  }
  return [];
}

function renderTaskFilesList(files = []) {
  const { taskFilesListEl, taskFileContentEl } = getElements();
  if (!(taskFilesListEl instanceof HTMLElement) || !(taskFileContentEl instanceof HTMLElement)) {
    return;
  }
  if (!Array.isArray(files) || !files.length) {
    taskFilesListEl.innerHTML = `<div class="panel-subtle">No task files found.</div>`;
    taskFileContentEl.textContent = "No task file selected.";
    return;
  }
  taskFilesListEl.innerHTML = files.map((file) => `
    <button class="file-item ${file.relativePath === activeTaskFilePath ? "active" : ""}" data-state-browser-task-file="${h(file.relativePath)}">
      <span>${h(file.relativePath)}</span>
      <span class="file-type">${h(file.statusLabel)}</span>
    </button>
  `).join("");
  taskFilesListEl.querySelectorAll("[data-state-browser-task-file]").forEach((button) => {
    button.addEventListener("click", () => {
      loadTaskFile(String(button.getAttribute("data-state-browser-task-file") || "")).catch(() => {});
    });
  });
}

function stripTaskQueuePrefix(relativePath) {
  return relativePath.replace(/^(derpy-observer-task-queue|observer-task-queue|task-queue)\//, "");
}

async function loadTaskFile(relativePath = "") {
  const {
    selectedFileEl,
    taskFileContentEl
  } = getElements();
  const normalizedPath = String(relativePath || "").trim();
  activeTaskFilePath = normalizedPath;
  if (selectedFileEl) {
    selectedFileEl.value = normalizedPath;
  }
  if (taskFileContentEl) {
    taskFileContentEl.textContent = "Loading task file...";
  }
  renderTaskFilesList(buildTaskFiles());
  try {
    const isQueueFile = /^(derpy-observer-task-queue|observer-task-queue|task-queue)\//.test(normalizedPath);
    const scope = isQueueFile ? "queue" : "workspace";
    const requestPath = isQueueFile ? stripTaskQueuePrefix(normalizedPath) : normalizedPath;
    const response = await fetch(`/api/inspect/file?scope=${encodeURIComponent(scope)}&file=${encodeURIComponent(requestPath)}`);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load task file");
    }
    if (payload.relocated && String(payload.file || "").trim()) {
      activeTaskFilePath = String(payload.file || "").trim();
      if (selectedFileEl) {
        selectedFileEl.value = activeTaskFilePath;
      }
    }
    if (taskFileContentEl) {
      taskFileContentEl.textContent = payload.content || "(empty file)";
    }
    renderTaskFilesList(buildTaskFiles());
  } catch (error) {
    if (taskFileContentEl) {
      taskFileContentEl.textContent = `Failed to load task file: ${error.message}`;
    }
  }
}

async function refreshTaskFiles(options = {}) {
  updateScopeView();
  if (options.preserveSelection === false) {
    activeTaskFilePath = "";
  }
  const { selectedFileEl } = getElements();
  const files = buildTaskFiles();
  renderTaskFilesList(files);
  if (!files.length) {
    if (selectedFileEl) {
      selectedFileEl.value = "";
    }
    return;
  }
  const preferredFile = activeTaskFilePath && files.some((file) => file.relativePath === activeTaskFilePath)
    ? activeTaskFilePath
    : files[0].relativePath;
  await loadTaskFile(preferredFile);
}

async function loadFile(relativePath = "") {
  const {
    selectedFileEl,
    fileContentEl,
    fileListEl
  } = getElements();
  const normalizedPath = String(relativePath || "").trim();
  activeFileKey = normalizedPath;
  if (selectedFileEl) {
    selectedFileEl.value = normalizedPath;
  }
  if (fileContentEl) {
    fileContentEl.textContent = "Loading file...";
  }
  fileListEl?.querySelectorAll(".file-item").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-state-browser-file") === normalizedPath);
  });
  try {
    const response = await fetch(`/api/inspect/file?scope=${encodeURIComponent(activeScope)}&file=${encodeURIComponent(normalizedPath)}`);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load file");
    }
    if (fileContentEl) {
      fileContentEl.textContent = payload.content || "(empty file)";
    }
    updateScopeView();
  } catch (error) {
    if (fileContentEl) {
      fileContentEl.textContent = `Failed to load file: ${error.message}`;
    }
  }
}

async function deleteSelectedFile() {
  const { deleteFileBtn, fileContentEl } = getElements();
  const file = String(activeFileKey || "").trim();
  if (!file || isTaskFilesScopeSelected()) {
    return;
  }
  if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(`Delete ${file}?`)) {
    return;
  }
  if (deleteFileBtn) {
    deleteFileBtn.disabled = true;
  }
  if (fileContentEl) {
    fileContentEl.textContent = "Deleting file...";
  }
  try {
    const fetchFn = pluginAdminFetchRef ?? fetch;
    const response = await fetchFn(`/api/inspect/file?scope=${encodeURIComponent(activeScope)}&file=${encodeURIComponent(file)}`, {
      method: "DELETE"
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "delete failed");
    }
    renderHint(`Deleted ${file}.`);
    activeFileKey = "";
    await loadTree({ preserveSelection: false });
  } catch (error) {
    if (fileContentEl) {
      fileContentEl.textContent = `Delete failed: ${error.message}`;
    }
    updateScopeView();
  }
}

async function loadTree(options = {}) {
  updateScopeView();
  if (isTaskFilesScopeSelected()) {
    return refreshTaskFiles(options);
  }
  const {
    fileListEl,
    fileContentEl,
    selectedFileEl
  } = getElements();
  if (!(fileListEl instanceof HTMLElement) || !(fileContentEl instanceof HTMLElement)) {
    return;
  }
  if (options.preserveSelection === false) {
    activeFileKey = "";
  }
  fileListEl.innerHTML = "Loading files...";
  fileContentEl.textContent = "Select a file to inspect.";
  if (selectedFileEl) {
    selectedFileEl.value = activeFileKey || "";
  }
  try {
    const response = await fetch(`/api/inspect/tree?scope=${encodeURIComponent(activeScope)}`);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load files");
    }
    const entries = Array.isArray(payload.entries)
      ? payload.entries.filter((entry) => String(entry.relativePath || "") !== ".")
      : [];
    const files = entries.filter((entry) => entry.type === "file");
    if (!entries.length) {
      fileListEl.innerHTML = `<div class="panel-subtle">No files found in this scope.</div>`;
      return;
    }
    fileListEl.innerHTML = entries.map((entry) => {
      const relativePath = String(entry.relativePath || entry.path || "").trim();
      const isFile = entry.type === "file";
      return `<button class="file-item${isFile ? "" : " is-dir"}${relativePath === activeFileKey ? " active" : ""}" data-state-browser-file="${h(relativePath)}" data-type="${h(entry.type || "")}"${isFile ? "" : " disabled"}><span>${h(relativePath)}</span><span class="file-type">${h(entry.type || "")}</span></button>`;
    }).join("");
    fileListEl.querySelectorAll("[data-state-browser-file]").forEach((button) => {
      if (button.getAttribute("data-type") !== "file") {
        return;
      }
      button.addEventListener("click", () => {
        loadFile(String(button.getAttribute("data-state-browser-file") || "")).catch(() => {});
      });
    });
    if (activeFileKey && files.some((entry) => String(entry.relativePath || entry.path || "").trim() === activeFileKey)) {
      await loadFile(activeFileKey);
      return;
    }
    activeFileKey = "";
    if (selectedFileEl) {
      selectedFileEl.value = "";
    }
    if (!files.length) {
      fileContentEl.textContent = "This scope currently contains directories but no readable files.";
    }
  } catch (error) {
    fileListEl.innerHTML = `<div class="panel-subtle">Failed to load files: ${h(error.message)}</div>`;
  }
}

async function loadStateBrowser(options = {}) {
  if (options.scope) {
    activeScope = String(options.scope || "workspace").trim() || "workspace";
  }
  updateScopeView();
  if (isTaskFilesScopeSelected()) {
    return refreshTaskFiles(options);
  }
  return loadTree(options);
}

async function resetSimpleState() {
  const { resetSimpleStateBtn, fileContentEl, taskFileContentEl } = getElements();
  const confirmationText = "This will clear Nova's internal test projects, queue/runtime logs, observer input/output, and generated prompt logs, then seed one simple checkbox project. Continue?";
  if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(confirmationText)) {
    return;
  }
  if (resetSimpleStateBtn) {
    resetSimpleStateBtn.disabled = true;
  }
  renderHint("Resetting internal state...");
  try {
    const fetchFn = pluginAdminFetchRef ?? fetch;
    const response = await fetchFn("/api/state/reset-simple-project", {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "reset failed");
    }
    const summaryLines = Array.isArray(payload.summaryLines) ? payload.summaryLines : [];
    const summaryText = summaryLines.length ? summaryLines.join("\n") : (payload.message || "Reset complete.");
    renderHint(payload.message || "Reset complete.");
    if (isTaskFilesScopeSelected()) {
      if (taskFileContentEl) {
        taskFileContentEl.textContent = summaryText;
      }
    } else if (fileContentEl) {
      fileContentEl.textContent = summaryText;
    }
    await Promise.all([
      typeof observerAppRef?.loadTaskQueue === "function"
        ? observerAppRef.loadTaskQueue()
        : Promise.resolve(),
      typeof observerAppRef?.loadProjectsPluginPanel === "function"
        ? observerAppRef.loadProjectsPluginPanel()
        : Promise.resolve()
    ]);
    await loadStateBrowser({ preserveSelection: false });
  } catch (error) {
    const message = `Reset failed: ${error.message}`;
    renderHint(message);
    if (isTaskFilesScopeSelected()) {
      if (taskFileContentEl) {
        taskFileContentEl.textContent = message;
      }
    } else if (fileContentEl) {
      fileContentEl.textContent = message;
    }
  } finally {
    if (resetSimpleStateBtn) {
      resetSimpleStateBtn.disabled = false;
    }
  }
}

function bindEvents(root = stateBrowserRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.stateBrowserBound === "1") {
    return;
  }
  const {
    scopeSelectEl,
    reloadFilesBtn,
    deleteFileBtn,
    resetSimpleStateBtn
  } = getElements(root);
  if (scopeSelectEl) {
    scopeSelectEl.addEventListener("change", () => {
      activeScope = String(scopeSelectEl.value || "workspace").trim() || "workspace";
      if (isTaskFilesScopeSelected()) {
        activeFileKey = "";
      } else {
        activeTaskFilePath = "";
      }
      loadStateBrowser({ preserveSelection: true }).catch(() => {});
    });
  }
  if (reloadFilesBtn) {
    reloadFilesBtn.addEventListener("click", () => {
      loadStateBrowser({ preserveSelection: true }).catch(() => {});
    });
  }
  if (deleteFileBtn) {
    deleteFileBtn.addEventListener("click", () => {
      deleteSelectedFile().catch(() => {});
    });
  }
  if (resetSimpleStateBtn) {
    resetSimpleStateBtn.addEventListener("click", () => {
      resetSimpleState().catch(() => {});
    });
  }
  root.dataset.stateBrowserBound = "1";
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  if (stateBrowserRoot !== root) {
    activeScope = "workspace";
    activeFileKey = "";
    activeTaskFilePath = "";
  }
  stateBrowserRoot = root;
  observerAppRef = context?.observerApp && typeof context.observerApp === "object"
    ? context.observerApp
    : {};
  pluginAdminFetchRef = typeof context?.pluginAdminFetch === "function"
    ? context.pluginAdminFetch
    : null;

  ensureMarkup(root);
  await loadStateBrowserManifest();
  bindEvents(root);
  updateScopeView();

  if (observerAppRef && typeof observerAppRef === "object") {
    observerAppRef.refreshStateBrowserPlugin = async (options = {}) => {
      if (!(stateBrowserRoot instanceof HTMLElement) || !stateBrowserRoot.isConnected) {
        return;
      }
      await loadStateBrowser(options);
    };
  }

  await loadStateBrowser({ preserveSelection: true });
}
