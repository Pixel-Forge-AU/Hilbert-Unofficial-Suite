export function createObserverProjectState(context = {}) {
  const {
    OBSERVER_INPUT_HOST_ROOT,
    PROJECT_ARCHIVE_OUTPUT_ROOT,
    PROJECT_BACKUP_OUTPUT_ROOT,
    PROJECT_MARKER_FILE_NAME = ".observer-project.json",
    PROJECT_READY_OUTPUT_ROOT,
    PROJECT_ROLE_PLAYBOOKS,
    TASK_QUEUE_CLOSED,
    buildProjectPipelineCollection,
    buildProjectFragmentSummary,
    classifyFailureText,
    compactTaskText,
    ensureProjectTodoForWorkspaceProject,
    fs,
    getProjectConfig,
    listAllTasks,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    opportunityScanState,
    parseProjectRoleTaskBoardState,
    path,
    readContainerFile,
    readJsonFileIfExists,
    readTextFileIfExists
  } = context;

  function normalizeProjectHistoryKey(...values) {
    for (const value of values) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized) {
        return normalized;
      }
    }
    return "";
  }

  function parseProjectTimestampLabel(label = "") {
    const text = String(label || "").trim();
    if (!text) {
      return 0;
    }
    const direct = Date.parse(text);
    if (Number.isFinite(direct)) {
      return direct;
    }
    const match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-(.+))?$/);
    if (!match) {
      return 0;
    }
    const normalized = `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseMarkdownCheckboxLines(content = "") {
    const checked = [];
    const unchecked = [];
    const isPlaceholderCheckboxLabel = (value = "") => {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized === "none"
        || normalized === "n/a"
        || normalized === "na"
        || normalized === "no active tasks"
        || normalized === "no pending tasks"
        || normalized === "no completed tasks";
    };
    for (const rawLine of String(content || "").split(/\r?\n/)) {
      const match = rawLine.match(/^\s*(?:[-*]\s+)?\[([^\]]*)\]\s+(.+?)\s*$/);
      if (!match) {
        continue;
      }
      const label = compactTaskText(String(match[2] || "").trim(), 220);
      if (!label || isPlaceholderCheckboxLabel(label)) {
        continue;
      }
      if (/^[xX]$/.test(String(match[1] || "").trim())) {
        checked.push(label);
      } else {
        unchecked.push(label);
      }
    }
    return { checked, unchecked };
  }

  function extractDirectiveObjectiveForOverview(content = "") {
    const lines = String(content || "").split(/\r?\n/);
    let insideObjectiveSection = false;
    const collected = [];
    for (const rawLine of lines) {
      const line = String(rawLine || "");
      if (/^\s*##\s+objective\s*$/i.test(line)) {
        insideObjectiveSection = true;
        continue;
      }
      if (insideObjectiveSection && /^\s*##\s+/.test(line)) {
        break;
      }
      if (insideObjectiveSection) {
        const trimmed = line.trim();
        if (!trimmed || /^[-*]\s+/.test(trimmed)) {
          continue;
        }
        collected.push(trimmed);
      }
    }
    if (collected.length) {
      return compactTaskText(collected.join(" "), 260);
    }
    const inlineMatch = String(content || "").match(/^\s*objective\s*:\s*(.+)$/im);
    if (inlineMatch?.[1]) {
      return compactTaskText(String(inlineMatch[1]).trim(), 260);
    }
    const nonHeadingLines = lines
      .map((line) => String(line || "").trim())
      .filter((line) => line && !/^#/.test(line) && !/^(priorities?|notes?)\s*:?\s*$/i.test(line));
    return compactTaskText(nonHeadingLines.slice(0, 2).join(" "), 260);
  }

  function buildChecklistSummary({
    todoChecked = [],
    todoUnchecked = [],
    roleChecked = [],
    roleUnchecked = [],
    directiveChecked = [],
    directiveUnchecked = [],
    directiveObjective = "",
    directiveCompleted = false,
    todoPath = "",
    roleTaskPath = "",
    directivePath = ""
  } = {}) {
    const todoDone = Array.isArray(todoChecked) ? todoChecked : [];
    const todoOpen = Array.isArray(todoUnchecked) ? todoUnchecked : [];
    const roleDone = Array.isArray(roleChecked) ? roleChecked : [];
    const roleOpen = Array.isArray(roleUnchecked) ? roleUnchecked : [];
    const directiveDoneItems = Array.isArray(directiveChecked) ? directiveChecked : [];
    const directiveOpenItems = Array.isArray(directiveUnchecked) ? directiveUnchecked : [];
    const todoTotal = todoDone.length + todoOpen.length;
    const roleTotal = roleDone.length + roleOpen.length;
    const directiveTotal = directiveDoneItems.length + directiveOpenItems.length + (directiveObjective ? 1 : 0);
    const directiveDoneCount = directiveDoneItems.length + (directiveCompleted ? 1 : 0);
    const directiveOpenCount = directiveOpenItems.length + (!directiveCompleted && directiveObjective ? 1 : 0);
    const totalItems = todoTotal + roleTotal + directiveTotal;
    const completedItems = todoDone.length + roleDone.length + directiveDoneCount;
    const completionPercent = totalItems > 0
      ? Math.round((completedItems / totalItems) * 100)
      : 0;
    return {
      todoPath,
      roleTaskPath,
      directivePath,
      todo: {
        checkedCount: todoDone.length,
        uncheckedCount: todoOpen.length,
        checked: todoDone.slice(0, 8),
        unchecked: todoOpen.slice(0, 8)
      },
      roles: {
        checkedCount: roleDone.length,
        uncheckedCount: roleOpen.length,
        checked: roleDone.slice(0, 8),
        unchecked: roleOpen.slice(0, 8)
      },
      directive: {
        objective: compactTaskText(String(directiveObjective || "").trim(), 260),
        checkedCount: directiveDoneCount,
        uncheckedCount: directiveOpenCount,
        checked: directiveDoneItems.slice(0, 8),
        unchecked: directiveOpenItems.slice(0, 8),
        completed: directiveCompleted === true
      },
      totals: {
        completedItems,
        openItems: Math.max(0, totalItems - completedItems),
        totalItems,
        completionPercent
      }
    };
  }

  async function readHostProjectBoardState(projectRoot = "") {
    const normalizedRoot = String(projectRoot || "").trim();
    if (!normalizedRoot) {
      return {
        checklist: buildChecklistSummary(),
        roleReports: [],
        activeRoles: [],
        assessment: null
      };
    }
    const [todoContent, roleContent, directiveContent] = await Promise.all([
      readTextFileIfExists(path.join(normalizedRoot, "PROJECT-TODO.md")),
      readTextFileIfExists(path.join(normalizedRoot, "PROJECT-ROLE-TASKS.md")),
      readTextFileIfExists(path.join(normalizedRoot, "directive.md"))
    ]);
    const todoState = parseMarkdownCheckboxLines(todoContent);
    const roleState = parseMarkdownCheckboxLines(roleContent);
    const directiveState = parseMarkdownCheckboxLines(directiveContent);
    const directiveObjective = extractDirectiveObjectiveForOverview(directiveContent);
    const directiveInlineChecked = /\[[xX]\]/.test(String(directiveContent || ""));
    const directiveInlineUnchecked = /\[\s\]/.test(String(directiveContent || ""));
    const directiveCompleted = Boolean(
      directiveObjective
      && (
        (directiveState.checked.length && !directiveState.unchecked.length)
        || (directiveInlineChecked && !directiveInlineUnchecked)
      )
    );
    const roleBoardState = parseProjectRoleTaskBoardState(roleContent);
    return {
      checklist: buildChecklistSummary({
        todoChecked: todoState.checked,
        todoUnchecked: todoState.unchecked,
        roleChecked: roleState.checked,
        roleUnchecked: roleState.unchecked,
        directiveChecked: directiveState.checked,
        directiveUnchecked: directiveState.unchecked,
        directiveObjective,
        directiveCompleted,
        todoPath: path.join(normalizedRoot, "PROJECT-TODO.md"),
        roleTaskPath: path.join(normalizedRoot, "PROJECT-ROLE-TASKS.md"),
        directivePath: path.join(normalizedRoot, "directive.md")
      }),
      roleReports: Array.isArray(roleBoardState?.roleReports) ? roleBoardState.roleReports : [],
      activeRoles: Array.isArray(roleBoardState?.activeRoles) ? roleBoardState.activeRoles : [],
      assessment: roleBoardState?.assessment && typeof roleBoardState.assessment === "object"
        ? roleBoardState.assessment
        : null
    };
  }

  function splitProjectRoleReportsForPanel(roleReports = []) {
    const reports = Array.isArray(roleReports)
      ? roleReports.filter((entry) => entry && typeof entry === "object")
      : [];
    return {
      visibleRoles: reports
        .filter((entry) => entry?.selected || Number(entry?.totalCount || 0) > 0)
        .slice(0, 12),
      deferredRoles: reports
        .filter((entry) => String(entry?.status || "").trim().toLowerCase() === "suggested")
        .slice(0, 6)
    };
  }

  async function readWorkspaceProjectMarker(projectPath = "") {
    const normalizedPath = String(projectPath || "").trim();
    if (!normalizedPath) {
      return null;
    }
    try {
      const raw = await readContainerFile(`${normalizedPath}/${PROJECT_MARKER_FILE_NAME}`);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async function listInputProjectHistoryEntries() {
    let entries = [];
    try {
      entries = await fs.readdir(OBSERVER_INPUT_HOST_ROOT, { withFileTypes: true });
    } catch {
      return [];
    }
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || String(entry.name || "").startsWith(".")) {
        continue;
      }
      const projectPath = path.join(OBSERVER_INPUT_HOST_ROOT, entry.name);
      let stat;
      try {
        stat = await fs.stat(projectPath);
      } catch {
        continue;
      }
      const marker = await readJsonFileIfExists(path.join(projectPath, PROJECT_MARKER_FILE_NAME));
      projects.push({
        kind: "input",
        name: String(marker?.projectName || entry.name || "").trim() || String(entry.name || "").trim(),
        sourceName: String(marker?.sourceName || entry.name || "").trim() || String(entry.name || "").trim(),
        path: projectPath,
        modifiedAt: Number(stat?.mtimeMs || 0),
        importedAt: Number(marker?.importedAt || 0),
        marker
      });
    }
    return projects;
  }

  async function scanStampedProjectArtifacts(rootPath = "", kind = "ready") {
    let stampEntries = [];
    try {
      stampEntries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const artifacts = [];
    for (const stampEntry of stampEntries) {
      if (!stampEntry.isDirectory()) {
        continue;
      }
      const stampRoot = path.join(rootPath, stampEntry.name);
      let projectEntries = [];
      try {
        projectEntries = await fs.readdir(stampRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      const occurredAt = parseProjectTimestampLabel(stampEntry.name);
      for (const projectEntry of projectEntries) {
        if (!projectEntry.isDirectory()) {
          continue;
        }
        const projectPath = path.join(stampRoot, projectEntry.name);
        const marker = await readJsonFileIfExists(path.join(projectPath, PROJECT_MARKER_FILE_NAME));
        let stat;
        try {
          stat = await fs.stat(projectPath);
        } catch {
          stat = null;
        }
        artifacts.push({
          kind,
          label: stampEntry.name,
          name: String(marker?.projectName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
          sourceName: String(marker?.sourceName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
          path: projectPath,
          occurredAt: occurredAt || Number(stat?.mtimeMs || 0),
          marker
        });
      }
    }
    return artifacts;
  }

  async function scanBackupProjectArtifacts(rootPath = "") {
    let projectEntries = [];
    try {
      projectEntries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const artifacts = [];
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) {
        continue;
      }
      const projectRoot = path.join(rootPath, projectEntry.name);
      let snapshotEntries = [];
      try {
        snapshotEntries = await fs.readdir(projectRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const snapshotEntry of snapshotEntries) {
        if (!snapshotEntry.isDirectory()) {
          continue;
        }
        const snapshotPath = path.join(projectRoot, snapshotEntry.name);
        const marker = await readJsonFileIfExists(path.join(snapshotPath, PROJECT_MARKER_FILE_NAME));
        let stat;
        try {
          stat = await fs.stat(snapshotPath);
        } catch {
          stat = null;
        }
        const reasonMatch = String(snapshotEntry.name || "").match(/^[^-].*?-(import|periodic|snapshot|manual|ready|archive)$/i);
        artifacts.push({
          kind: "backup",
          label: snapshotEntry.name,
          reason: String(reasonMatch?.[1] || "").trim().toLowerCase(),
          name: String(marker?.projectName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
          sourceName: String(marker?.sourceName || projectEntry.name || "").trim() || String(projectEntry.name || "").trim(),
          path: snapshotPath,
          occurredAt: parseProjectTimestampLabel(snapshotEntry.name) || Number(stat?.mtimeMs || 0),
          marker
        });
      }
    }
    return artifacts;
  }

  function summarizeProjectArtifact(artifact = {}) {
    return {
      kind: String(artifact.kind || "").trim(),
      label: String(artifact.label || "").trim(),
      path: String(artifact.path || "").trim(),
      occurredAt: Number(artifact.occurredAt || 0),
      reason: String(artifact.reason || "").trim()
    };
  }

  function summarizeProjectPipelineForPanel(pipeline = {}) {
    return {
      projectWorkKey: String(pipeline.projectWorkKey || "").trim(),
      focus: compactTaskText(String(pipeline.focus || "").trim(), 200),
      roleName: String(pipeline.projectWorkRoleName || "").trim(),
      roleReason: compactTaskText(String(pipeline.projectWorkRoleReason || "").trim(), 180),
      latestTaskId: String(pipeline.latestTaskId || "").trim(),
      latestCodename: String(pipeline.latestCodename || "").trim(),
      latestRequestedBrainLabel: String(pipeline.latestRequestedBrainLabel || pipeline.latestRequestedBrainId || "").trim(),
      finalStatus: String(pipeline.finalStatus || "").trim(),
      finalFailureClassification: String(pipeline.finalFailureClassification || "").trim(),
      attemptCount: Number(pipeline.attemptCount || 0),
      completedAttemptCount: Number(pipeline.completedAttemptCount || 0),
      failedAttemptCount: Number(pipeline.failedAttemptCount || 0),
      startedAt: Number(pipeline.startedAt || 0),
      updatedAt: Number(pipeline.updatedAt || 0)
    };
  }

  function summarizeProjectTaskForPanel(task = {}) {
    return {
      id: String(task.id || "").trim(),
      codename: String(task.codename || task.id || "Task").trim(),
      status: String(task.status || "").trim(),
      requestedBrainLabel: String(task.requestedBrainLabel || task.requestedBrainId || "").trim(),
      focus: compactTaskText(String(task.projectWorkFocus || task.message || "").trim(), 180),
      roleName: String(task.projectWorkRoleName || "").trim(),
      roleReason: compactTaskText(String(task.projectWorkRoleReason || "").trim(), 180),
      summary: compactTaskText(String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim(), 220),
      failureClassification: String(task.failureClassification || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim())).trim(),
      createdAt: Number(task.createdAt || 0),
      updatedAt: Number(task.completedAt || task.updatedAt || task.createdAt || 0)
    };
  }

  function deriveProjectPanelStage(entry = {}) {
    if (entry?.workspace?.present) {
      return entry.workspace.activeTaskCount > 0 || entry.workspace.waitingTaskCount > 0
        ? "active"
        : "workspace";
    }
    if (entry?.source?.present) {
      return "intake";
    }
    if (Array.isArray(entry?.history?.readyExports) && entry.history.readyExports.length) {
      return "completed";
    }
    if (Array.isArray(entry?.history?.archivedExports) && entry.history.archivedExports.length) {
      return "archived";
    }
    return "history";
  }

  const RECENT_READY_EXPORT_OVERVIEW_GRACE_MS = 5 * 60 * 1000;

  function shouldPreferCompletedProjectOverview(entry = {}) {
    const latestReadyExport = Array.isArray(entry?.history?.readyExports) ? entry.history.readyExports[0] : null;
    if (!latestReadyExport?.path) {
      return false;
    }
    if (!entry?.workspace?.present) {
      return true;
    }
    const importedAt = Number(entry?.workspace?.importedAt || 0);
    const modifiedAt = Number(entry?.workspace?.modifiedAt || 0);
    const exportedAt = Number(latestReadyExport?.occurredAt || 0);
    if (!importedAt || !exportedAt) {
      return false;
    }
    const freshlyReimported = importedAt >= exportedAt && importedAt - exportedAt <= RECENT_READY_EXPORT_OVERVIEW_GRACE_MS;
    const untouchedSinceImport = modifiedAt <= importedAt;
    return freshlyReimported && untouchedSinceImport;
  }

  function buildProjectConfigPayload() {
    return {
      projects: getProjectConfig(),
      rolePlaybooks: PROJECT_ROLE_PLAYBOOKS.map((entry) => ({
        name: entry.name,
        playbook: entry.playbook
      }))
    };
  }

  async function buildProjectSystemStatePayload() {
    const projectConfig = getProjectConfig();
    const workspaceProjects = await listContainerWorkspaceProjects().catch(() => []);
    const { queued, waiting, inProgress, done, failed } = await listAllTasks();
    const closed = await listTasksByFolder(TASK_QUEUE_CLOSED, "closed").catch(() => []);
    const allProjectTaskHistory = [...queued, ...waiting, ...inProgress, ...done, ...failed, ...closed]
      .filter((task) => String(task?.projectName || "").trim());
    const [inputProjects, readyArtifacts, archivedArtifacts, backupArtifacts, workspaceProjectDetails] = await Promise.all([
      listInputProjectHistoryEntries(),
      scanStampedProjectArtifacts(PROJECT_READY_OUTPUT_ROOT, "ready"),
      scanStampedProjectArtifacts(PROJECT_ARCHIVE_OUTPUT_ROOT, "archive"),
      scanBackupProjectArtifacts(PROJECT_BACKUP_OUTPUT_ROOT),
      Promise.all(workspaceProjects.map(async (project) => ({
        ...project,
        marker: await readWorkspaceProjectMarker(project.path),
        todoState: await ensureProjectTodoForWorkspaceProject(project).catch(() => null)
      })))
    ]);
    const activeProjectTasks = [...queued, ...inProgress].filter((task) => String(task.internalJobType || "").trim() === "project_cycle");
    const waitingProjectTasks = waiting.filter((task) => String(task.internalJobType || "").trim() === "project_cycle");
    const recentProjectFailures = [...failed, ...done, ...closed]
      .filter((task) => String(task.internalJobType || "").trim() === "project_cycle")
      .filter((task) => {
        const status = String(task.status || "").trim().toLowerCase();
        return status === "failed" || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || "").trim()) !== "unknown";
      })
      .sort((left, right) => Number(right.completedAt || right.updatedAt || right.createdAt || 0) - Number(left.completedAt || left.updatedAt || left.createdAt || 0))
      .slice(0, 12)
      .map((task) => ({
        id: task.id,
        codename: task.codename,
        projectName: task.projectName || "",
        status: task.status || "",
        updatedAt: Number(task.completedAt || task.updatedAt || task.createdAt || 0),
        failureClassification: String(task.failureClassification || classifyFailureText(String(task.resultSummary || task.reviewSummary || task.workerSummary || "").trim())).trim(),
        summary: compactTaskText(String(task.toolLoopDiagnostics?.summary || task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim(), 220),
        toolLoopSummary: compactTaskText(String(task.toolLoopDiagnostics?.summary || "").trim(), 220)
      }));
    const projectTaskCounts = new Map();
    for (const task of activeProjectTasks) {
      const key = String(task.projectName || "").trim().toLowerCase();
      if (!key) {
        continue;
      }
      projectTaskCounts.set(key, Number(projectTaskCounts.get(key) || 0) + 1);
    }
    const workspaceProjectState = workspaceProjects
      .map((project) => ({
        name: String(project.name || "").trim(),
        path: String(project.path || "").trim(),
        modifiedAt: Number(project.modifiedAt || 0),
        activeTaskCount: Number(projectTaskCounts.get(String(project.name || "").trim().toLowerCase()) || 0)
      }))
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    const recentImports = Object.entries(opportunityScanState.projectRotation?.recentImports || {})
      .map(([sourceName, importedAt]) => ({
        sourceName: String(sourceName || "").trim(),
        importedAt: Number(importedAt || 0)
      }))
      .sort((left, right) => right.importedAt - left.importedAt)
      .slice(0, 12);
    const allProjectPipelines = buildProjectPipelineCollection(allProjectTaskHistory);
    const recentProjectPipelines = allProjectPipelines
      .slice(0, 12)
      .map((pipeline) => ({
        projectWorkKey: pipeline.projectWorkKey,
        projectName: pipeline.projectName,
        focus: pipeline.focus,
        latestTaskId: pipeline.latestTaskId,
        latestCodename: pipeline.latestCodename,
        latestRequestedBrainId: pipeline.latestRequestedBrainId,
        latestRequestedBrainLabel: pipeline.latestRequestedBrainLabel,
        finalStatus: pipeline.finalStatus,
        finalFailureClassification: pipeline.finalFailureClassification,
        attemptCount: pipeline.attemptCount,
        handoffCount: pipeline.handoffCount,
        completedAttemptCount: pipeline.completedAttemptCount,
        failedAttemptCount: pipeline.failedAttemptCount,
        capabilityMismatchCount: pipeline.capabilityMismatchCount,
        updatedAt: pipeline.updatedAt
      }));
    const projectPanelMap = new Map();
    const ensureProjectPanel = ({ name = "", sourceName = "" } = {}) => {
      const key = normalizeProjectHistoryKey(sourceName, name);
      if (!key) {
        return null;
      }
      if (!projectPanelMap.has(key)) {
        projectPanelMap.set(key, {
          key,
          name: String(name || sourceName || "").trim(),
          sourceName: String(sourceName || name || "").trim(),
          aliases: [],
          source: { present: false, path: "", modifiedAt: 0, importedAt: 0 },
          workspace: { present: false, path: "", modifiedAt: 0, importedAt: 0, activeTaskCount: 0, waitingTaskCount: 0 },
          checklist: buildChecklistSummary(),
          fragments: null,
          roleReports: [],
          deferredRoleReports: [],
          activeRoles: [],
          assessment: null,
          activeTasks: [],
          waitingTasks: [],
          recentJobs: [],
          recentTaskAttempts: [],
          history: { readyExports: [], archivedExports: [], backups: [] },
          metrics: { completedJobs: 0, failedJobs: 0, activeJobs: 0 },
          lastActivityAt: 0,
          currentStage: "history"
        });
      }
      const existing = projectPanelMap.get(key);
      existing.name = String(existing.name || name || sourceName || "").trim() || String(name || sourceName || "").trim();
      existing.sourceName = String(existing.sourceName || sourceName || name || "").trim() || String(sourceName || name || "").trim();
      for (const alias of [name, sourceName]) {
        const normalizedAlias = String(alias || "").trim();
        if (normalizedAlias && !existing.aliases.includes(normalizedAlias)) {
          existing.aliases.push(normalizedAlias);
        }
      }
      return existing;
    };

    for (const sourceProject of inputProjects) {
      const panel = ensureProjectPanel({ name: sourceProject.name, sourceName: sourceProject.sourceName });
      if (!panel) {
        continue;
      }
      panel.source = {
        present: true,
        path: String(sourceProject.path || "").trim(),
        modifiedAt: Number(sourceProject.modifiedAt || 0),
        importedAt: Number(sourceProject.importedAt || 0)
      };
      panel.lastActivityAt = Math.max(panel.lastActivityAt, panel.source.modifiedAt, panel.source.importedAt);
    }

    for (const project of workspaceProjectDetails) {
      const marker = project?.marker && typeof project.marker === "object" ? project.marker : {};
      const panel = ensureProjectPanel({
        name: String(marker?.projectName || project?.name || "").trim(),
        sourceName: String(marker?.sourceName || project?.name || "").trim()
      });
      if (!panel) {
        continue;
      }
      const activeTaskCount = activeProjectTasks.filter((task) => normalizeProjectHistoryKey(task.projectName) === panel.key).length;
      const waitingTaskCount = waitingProjectTasks.filter((task) => normalizeProjectHistoryKey(task.projectName) === panel.key).length;
      panel.workspace = {
        present: true,
        path: String(project.path || "").trim(),
        modifiedAt: Number(project.modifiedAt || 0),
        importedAt: Number(marker?.importedAt || 0),
        activeTaskCount,
        waitingTaskCount
      };
      if (project?.todoState) {
        panel.checklist = buildChecklistSummary({
          todoChecked: project.todoState.checked,
          todoUnchecked: project.todoState.unchecked,
          roleChecked: project.todoState.roleChecked,
          roleUnchecked: project.todoState.roleUnchecked,
          directiveChecked: Array.isArray(project.todoState?.directiveState?.checkedItems)
            ? project.todoState.directiveState.checkedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()).filter(Boolean)
            : [],
          directiveUnchecked: Array.isArray(project.todoState?.directiveState?.uncheckedItems)
            ? project.todoState.directiveState.uncheckedItems.map((entry) => String(entry?.label || entry?.focus || "").trim()).filter(Boolean)
            : [],
          directiveObjective: String(project.todoState?.directiveState?.objectiveText || "").trim(),
          directiveCompleted: project.todoState?.directiveCompleted === true,
          todoPath: String(project.todoState?.todoPath || "").trim(),
          roleTaskPath: String(project.todoState?.roleTaskPath || "").trim(),
          directivePath: String(project.todoState?.directiveState?.path ? `${project.path}/${project.todoState.directiveState.path}` : "").trim()
        });
        panel.roleReports = Array.isArray(project.todoState?.roleReports) ? project.todoState.roleReports : [];
        panel.activeRoles = Array.isArray(project.todoState?.activeRoles) ? project.todoState.activeRoles : [];
        panel.assessment = project.todoState?.assessment && typeof project.todoState.assessment === "object"
          ? project.todoState.assessment
          : panel.assessment;
      }
      if (typeof buildProjectFragmentSummary === "function") {
        panel.fragments = await buildProjectFragmentSummary({
          projectName: panel.name,
          projectPath: String(project.path || "").trim()
        }).catch(() => null);
      }
      panel.lastActivityAt = Math.max(panel.lastActivityAt, panel.workspace.modifiedAt, panel.workspace.importedAt);
    }

    const addArtifactHistory = (artifact = {}) => {
      const panel = ensureProjectPanel({ name: artifact.name, sourceName: artifact.sourceName });
      if (!panel) {
        return;
      }
      if (artifact.kind === "ready") {
        panel.history.readyExports.push(summarizeProjectArtifact(artifact));
      } else if (artifact.kind === "archive") {
        panel.history.archivedExports.push(summarizeProjectArtifact(artifact));
      } else if (artifact.kind === "backup") {
        panel.history.backups.push(summarizeProjectArtifact(artifact));
      }
      panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(artifact.occurredAt || 0));
    };
    readyArtifacts.forEach(addArtifactHistory);
    archivedArtifacts.forEach(addArtifactHistory);
    backupArtifacts.forEach(addArtifactHistory);

    const tasksByProjectKey = new Map();
    for (const task of allProjectTaskHistory) {
      const key = normalizeProjectHistoryKey(task.projectName);
      if (!key) {
        continue;
      }
      if (!tasksByProjectKey.has(key)) {
        tasksByProjectKey.set(key, []);
      }
      tasksByProjectKey.get(key).push(task);
      ensureProjectPanel({ name: task.projectName, sourceName: task.projectName });
    }

    const pipelinesByProjectKey = new Map();
    for (const pipeline of allProjectPipelines) {
      const key = normalizeProjectHistoryKey(pipeline.projectName);
      if (!key) {
        continue;
      }
      if (!pipelinesByProjectKey.has(key)) {
        pipelinesByProjectKey.set(key, []);
      }
      pipelinesByProjectKey.get(key).push(pipeline);
      ensureProjectPanel({ name: pipeline.projectName, sourceName: pipeline.projectName });
    }

    for (const panel of projectPanelMap.values()) {
      const projectTasks = (tasksByProjectKey.get(panel.key) || [])
        .sort((left, right) => Number(right.completedAt || right.updatedAt || right.createdAt || 0) - Number(left.completedAt || left.updatedAt || left.createdAt || 0));
      const projectPipelines = (pipelinesByProjectKey.get(panel.key) || [])
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
      panel.activeTasks = projectTasks.filter((task) => ["queued", "in_progress"].includes(String(task.status || "").trim())).slice(0, 6).map((task) => summarizeProjectTaskForPanel(task));
      panel.waitingTasks = projectTasks.filter((task) => String(task.status || "").trim() === "waiting_for_user").slice(0, 4).map((task) => summarizeProjectTaskForPanel(task));
      panel.recentTaskAttempts = projectTasks.filter((task) => !["queued", "in_progress", "waiting_for_user"].includes(String(task.status || "").trim())).slice(0, 8).map((task) => summarizeProjectTaskForPanel(task));
      panel.recentJobs = projectPipelines.slice(0, 8).map((pipeline) => summarizeProjectPipelineForPanel(pipeline));
      panel.metrics = {
        completedJobs: projectPipelines.filter((pipeline) => ["completed", "closed", "done"].includes(String(pipeline.finalStatus || "").trim())).length,
        failedJobs: projectPipelines.filter((pipeline) => String(pipeline.finalStatus || "").trim() === "failed").length,
        activeJobs: projectPipelines.filter((pipeline) => ["queued", "in_progress", "waiting_for_user"].includes(String(pipeline.finalStatus || "").trim())).length
      };
      for (const task of projectTasks) {
        panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(task.completedAt || task.updatedAt || task.createdAt || 0));
      }
      for (const pipeline of projectPipelines) {
        panel.lastActivityAt = Math.max(panel.lastActivityAt, Number(pipeline.updatedAt || 0));
      }
      panel.history.readyExports.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));
      panel.history.archivedExports.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));
      panel.history.backups.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));

      const hasActiveLiveTasks = panel.activeTasks.length > 0 || panel.waitingTasks.length > 0;
      const preferCompletedOverview = !hasActiveLiveTasks && shouldPreferCompletedProjectOverview(panel);
      const needsHostChecklist = !panel.workspace.present && !panel.checklist?.totals?.totalItems;
      if (preferCompletedOverview || needsHostChecklist) {
        const preferredHistoryPath = preferCompletedOverview
          ? panel.history.readyExports[0]?.path
          : (panel.source.present
            ? panel.source.path
            : (panel.history.readyExports[0]?.path || panel.history.archivedExports[0]?.path || panel.history.backups[0]?.path || ""));
        if (preferredHistoryPath) {
          const hostBoardState = await readHostProjectBoardState(preferredHistoryPath);
          panel.checklist = hostBoardState?.checklist || buildChecklistSummary();
          panel.roleReports = Array.isArray(hostBoardState?.roleReports) ? hostBoardState.roleReports : panel.roleReports;
          panel.activeRoles = Array.isArray(hostBoardState?.activeRoles) ? hostBoardState.activeRoles : panel.activeRoles;
          panel.assessment = hostBoardState?.assessment && typeof hostBoardState.assessment === "object"
            ? hostBoardState.assessment
            : panel.assessment;
        }
      }
      if (preferCompletedOverview) {
        panel.activeTasks = [];
        panel.waitingTasks = [];
        panel.metrics = {
          ...panel.metrics,
          activeJobs: 0
        };
        panel.currentStage = "completed";
      } else {
        panel.currentStage = deriveProjectPanelStage(panel);
      }
    }

    const projectPanels = [...projectPanelMap.values()]
      .map((panel) => {
        const rolePanels = splitProjectRoleReportsForPanel(panel.roleReports);
        return {
          ...panel,
          aliases: panel.aliases.slice(0, 8),
          activeRoles: Array.isArray(panel.activeRoles) ? panel.activeRoles.slice(0, 10) : [],
          roleReports: rolePanels.visibleRoles,
          deferredRoleReports: rolePanels.deferredRoles,
          assessment: panel.assessment && typeof panel.assessment === "object" ? panel.assessment : null,
          history: {
            readyExports: panel.history.readyExports.slice(0, 6),
            archivedExports: panel.history.archivedExports.slice(0, 6),
            backups: panel.history.backups.slice(0, 6)
          }
        };
      })
      .sort((left, right) => {
        const leftWorkspace = left.workspace.present ? 1 : 0;
        const rightWorkspace = right.workspace.present ? 1 : 0;
        if (leftWorkspace !== rightWorkspace) {
          return rightWorkspace - leftWorkspace;
        }
        return Number(right.lastActivityAt || 0) - Number(left.lastActivityAt || 0);
      });
    return {
      config: projectConfig,
      summary: {
        workspaceProjectCount: workspaceProjectState.length,
        activeProjectTaskCount: activeProjectTasks.length,
        waitingProjectTaskCount: waitingProjectTasks.length,
        recentProjectFailureCount: recentProjectFailures.length,
        trackedProjectCount: projectPanels.length,
        completedProjectCount: projectPanels.filter((panel) => panel.currentStage === "completed").length,
        historyOnlyProjectCount: projectPanels.filter((panel) => panel.currentStage === "history" || panel.currentStage === "archived").length
      },
      workspaceProjects: workspaceProjectState,
      activeProjectTasks: activeProjectTasks.slice(0, 20).map((task) => ({
        id: task.id,
        codename: task.codename,
        projectName: task.projectName || "",
        status: task.status || "",
        focus: compactTaskText(String(task.projectWorkFocus || task.message || "").trim(), 180),
        requestedBrainLabel: task.requestedBrainLabel || task.requestedBrainId || "",
        createdAt: Number(task.createdAt || 0),
        updatedAt: Number(task.updatedAt || task.createdAt || 0)
      })),
      recentImports,
      recentProjectPipelines,
      projectPanels,
      recentProjectFailures,
      rolePlaybooks: PROJECT_ROLE_PLAYBOOKS.map((entry) => ({
        name: entry.name,
        playbook: entry.playbook
      })),
      policies: {
        targetScoring: [
          "Filename matches and focus keywords are weighted heavily.",
          "Planning docs are penalized as concrete targets.",
          "README files get a small positive score.",
          "If no scored target exists, the first concrete file by extension is used."
        ],
        loopRepair: [
          "Repeated startup bundles are repaired locally for project-cycle tasks.",
          "Planning-only repeats are redirected into implementation roots.",
          "The named first target is advanced to the next concrete target after successful startup inspection.",
          "Inspection-only streaks now stop early unless the worker converges to a change, artifact, capability request, or valid no-change conclusion."
        ]
      }
    };
  }

  return {
    buildProjectConfigPayload,
    buildProjectSystemStatePayload
  };
}
