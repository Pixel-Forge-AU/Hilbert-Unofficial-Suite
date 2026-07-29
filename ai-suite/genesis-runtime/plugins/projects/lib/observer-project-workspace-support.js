export function createObserverProjectWorkspaceSupport(context = {}) {
  const {
    MAX_TASK_RESHAPE_ATTEMPTS,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    OBSERVER_INPUT_HOST_ROOT,
    TASK_QUEUE_CLOSED,
    appendDailyAssistantMemory,
    buildFailureReshapeMessage,
    canReshapeTask,
    chooseIdleWorkerBrainForSpecialty,
    classifyFailureText,
    compactTaskText,
    createQueuedTask,
    buildProjectFragmentContext,
    buildProjectAssessment,
    ensureProjectTodoForWorkspaceProject,
    findActiveProjectCycleTask,
    formatDateTimeForUser,
    fs,
    getObserverConfig,
    getProjectConfig,
    getProjectImplementationRoot,
    getTaskReshapeAttemptCount,
    hashRef,
    importRepositoryProjectToWorkspace,
    inferProjectCycleSpecialty,
    inferTaskSpecialty,
    listAllTasks,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    moveWorkspaceProjectToOutput,
    normalizeSummaryComparisonText,
    opportunityScanState,
    path,
    pickInspectionFile,
    snapshotWorkspaceProjectToOutput,
    syncWorkspaceProjectToRepositorySource,
    writeContainerTextFile
  } = context;
  const WORKSPACE_PROJECT_MARKER_FILE = ".observer-project.json";
  const GENERIC_WORKSPACE_PROJECT_NAMES = new Set([
    "app",
    "apps",
    "assets",
    "build",
    "coverage",
    "dist",
    "docs",
    "lib",
    "logs",
    "node_modules",
    "output",
    "outputs",
    "packages",
    "public",
    "scripts",
    "src",
    "test",
    "tests",
    "tmp",
    "temp"
  ]);
  const PROJECT_ROLE_NOISE_WORDS = new Set([
    "about",
    "across",
    "after",
    "aligned",
    "before",
    "best",
    "clear",
    "concrete",
    "current",
    "draft",
    "each",
    "evidence",
    "file",
    "files",
    "focused",
    "from",
    "into",
    "keep",
    "make",
    "next",
    "notes",
    "pass",
    "project",
    "review",
    "role",
    "scene",
    "story",
    "task",
    "tasks",
    "that",
    "their",
    "them",
    "this",
    "through",
    "update",
    "use",
    "using",
    "while",
    "with",
    "work"
  ]);
  const FAST_CREATIVE_ROLE_NAMES = new Set([
    "Story Architect",
    "Developmental Editor",
    "Line Editor",
    "Continuity Editor",
    "Character Writer",
    "Worldbuilding Designer",
    "Content Designer",
    "Brand Designer"
  ]);

  function sanitizeWorkspaceProjectName(name = "") {
    let decoded = String(name || "");
    try { decoded = decodeURIComponent(decoded); } catch { /* keep raw */ }
    return decoded
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "")
      .slice(0, 120);
  }

  function looksMalformedWorkspaceProjectName(name = "") {
    const text = String(name || "").trim();
    if (!text) {
      return true;
    }
    if (!/[a-z0-9]/i.test(text)) {
      return true;
    }
    return /["'\`]/.test(text);
  }

  function isGenericWorkspaceProjectName(name = "") {
    return GENERIC_WORKSPACE_PROJECT_NAMES.has(String(name || "").trim().toLowerCase());
  }

  function objectiveAllowsPlanningDocumentOutcome(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    return (
      /\breview the project structure\b/.test(text)
      || /\bidentify the best [a-z0-9 /-]*next step\b/.test(text)
      || /\bidentify the best next step\b/.test(text)
      || /\bclarify the most shippable next step\b/.test(text)
      || /\brecord the next concrete step\b/.test(text)
      || /\bupdate this todo file after each work pass\b/.test(text)
      || (/\bcheck(?:ing)? off completed items\b/.test(text) && /\bfollow-up tasks\b/.test(text))
      || /\bkeep project-todo\.md and project-role-tasks\.md aligned\b/.test(text)
      || /\brequired for export\b/.test(text)
      || /\bexport blocker\b/.test(text)
      || /\bcompletion evidence\b/.test(text)
    );
  }

  function buildExportRequirementsFocus(project = {}, todoState = {}) {
    const specialty = inferProjectCycleSpecialty(project, todoState, "");
    if (specialty === "creative") {
      return "Review the project structure and identify the best shippable story or content next step required for export, then record the exact export blocker or missing completion evidence in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.";
    }
    return "Review the project structure and identify the best runnable or shippable next step required for export, then record the exact export blocker or missing completion evidence in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.";
  }

  function collectProjectRoleKeywords(text = "") {
    return [...new Set(
      normalizeSummaryComparisonText(String(text || ""))
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !PROJECT_ROLE_NOISE_WORDS.has(token))
    )];
  }

  function scoreProjectRoleForFocus(focus = "", role = {}) {
    const normalizedFocus = normalizeSummaryComparisonText(String(focus || ""));
    if (!normalizedFocus) {
      return 0;
    }
    const unchecked = Array.isArray(role?.unchecked) ? role.unchecked : [];
    const recommended = Array.isArray(role?.recommended) ? role.recommended : [];
    const candidateTexts = [
      String(role?.reason || "").trim(),
      String(role?.playbook || "").trim(),
      ...unchecked.slice(0, 4),
      ...recommended.slice(0, 3)
    ].filter(Boolean);
    let score = role?.selected ? 30 : 0;
    if (String(role?.status || "").trim().toLowerCase() === "active") {
      score += 20;
    } else if (String(role?.status || "").trim().toLowerCase() === "planned") {
      score += 10;
    }
    for (const text of candidateTexts) {
      const normalizedText = normalizeSummaryComparisonText(String(text || ""));
      if (!normalizedText) {
        continue;
      }
      if (normalizedText === normalizedFocus) {
        score += 220;
        continue;
      }
      if (normalizedFocus.includes(normalizedText) || normalizedText.includes(normalizedFocus)) {
        score += 120;
      }
      const focusKeywords = collectProjectRoleKeywords(normalizedFocus);
      const textKeywords = new Set(collectProjectRoleKeywords(normalizedText));
      for (const token of focusKeywords) {
        if (textKeywords.has(token)) {
          score += 12;
        }
      }
    }
    return score;
  }

  function resolveProjectRoleForFocus(todoState = {}, focus = "") {
    const reports = Array.isArray(todoState?.roleReports) ? todoState.roleReports : [];
    if (!reports.length) {
      return null;
    }
    const activeNames = new Set(
      (Array.isArray(todoState?.activeRoles) ? todoState.activeRoles : [])
        .map((entry) => String(entry?.name || "").trim())
        .filter(Boolean)
    );
    const candidates = reports.filter((entry) => {
      const roleName = String(entry?.name || "").trim();
      if (!roleName) {
        return false;
      }
      return activeNames.size ? activeNames.has(roleName) : entry?.selected;
    });
    const pool = candidates.length ? candidates : reports.filter((entry) => entry?.selected);
    if (!pool.length) {
      return null;
    }
    const ranked = pool
      .map((entry) => ({
        entry,
        score: scoreProjectRoleForFocus(focus, entry)
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(left.entry?.name || "").localeCompare(String(right.entry?.name || ""));
      });
    const best = ranked[0];
    if (!best?.entry) {
      return null;
    }
    if (best.score <= 0 && pool.length !== 1) {
      return null;
    }
    return {
      name: String(best.entry.name || "").trim(),
      playbook: compactTaskText(String(best.entry.playbook || "").trim(), 220),
      reason: compactTaskText(
        String(best.entry.reason || best.entry.recommended?.[0] || best.entry.unchecked?.[0] || "").trim(),
        180
      )
    };
  }

  async function hostDirectoryLooksLikeImportableProject(hostPath = "", sourceName = "") {
    const normalizedPath = String(hostPath || "").trim();
    const normalizedName = String(sourceName || "").trim();
    if (!normalizedPath || looksMalformedWorkspaceProjectName(normalizedName) || isGenericWorkspaceProjectName(normalizedName)) {
      return false;
    }
    let entries = [];
    try {
      entries = await fs.readdir(normalizedPath, { withFileTypes: true });
    } catch {
      return false;
    }
    const visibleEntries = entries.filter((entry) => !String(entry.name || "").startsWith("."));
    if (!visibleEntries.length) {
      return false;
    }
    const lowerNames = new Set(visibleEntries.map((entry) => String(entry.name || "").trim().toLowerCase()));
    if (lowerNames.has(WORKSPACE_PROJECT_MARKER_FILE.toLowerCase())) {
      return true;
    }
    const hasDirective = lowerNames.has("directive.md");
    const hasPlanning = lowerNames.has("project-todo.md") || lowerNames.has("project-role-tasks.md");
    const hasReadme = lowerNames.has("readme.md");
    const hasPackageJson = lowerNames.has("package.json");
    const hasImplementationDir = visibleEntries.some((entry) =>
      entry.isDirectory() && /^(src|app|lib|server|api|assets|includes|observer-input|manuscript|chapters?)$/i.test(String(entry.name || "").trim())
    );
    const hasImplementationFile = visibleEntries.some((entry) =>
      entry.isFile() && /\.(js|jsx|ts|tsx|mjs|cjs|php|py|java|go|rs|c|cpp|cs|html|css|scss|sass|md|txt|json|ya?ml)$/i.test(String(entry.name || "").trim())
    );
    const hasArchiveFile = visibleEntries.some((entry) =>
      entry.isFile() && /\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/i.test(String(entry.name || "").trim())
    );
    return hasDirective || hasPlanning || hasReadme || hasPackageJson || hasImplementationDir || hasImplementationFile || hasArchiveFile;
  }

  async function listHistoricalProjectTasks(project) {
    const normalizedName = String(project?.name || "").trim().toLowerCase();
    const normalizedPath = String(project?.path || "").trim().toLowerCase();
    if (!normalizedName && !normalizedPath) {
      return [];
    }
    const { queued, waiting, inProgress, done, failed } = await listAllTasks();
    const closed = await listTasksByFolder(TASK_QUEUE_CLOSED, "closed");
    const allTasks = [...queued, ...waiting, ...inProgress, ...done, ...failed, ...closed];
    return allTasks
      .filter((task) => {
        const taskProjectName = String(task?.projectName || "").trim().toLowerCase();
        const text = [
          String(task?.message || ""),
          String(task?.originalMessage || ""),
          String(task?.notes || ""),
          String(task?.resultSummary || ""),
          String(task?.reviewSummary || "")
        ].join("\n").toLowerCase();
        return (normalizedName && taskProjectName === normalizedName)
          || (normalizedPath && text.includes(normalizedPath))
          || (normalizedName && text.includes(normalizedName));
      })
      .sort((left, right) => Number(left.createdAt || left.updatedAt || 0) - Number(right.createdAt || right.updatedAt || 0));
  }

  function buildProjectExportLogContent(project, todoState, projectTasks = []) {
    const lines = [
      `# Project Work Log: ${project.name}`,
      "",
      `Exported by Nova on ${new Date().toLocaleString("en-AU")}.`,
      `Workspace path: ${project.path}`,
      ""
    ];

    const meaningfulTasks = projectTasks.filter((task) => {
      const internalJobType = String(task?.internalJobType || "").trim();
      return internalJobType === "project_cycle"
        || internalJobType === "task_maintenance"
        || String(task?.sessionId || "").trim() === "project-cycle"
        || String(task?.sessionId || "").trim() === "task-maintenance"
        || String(task?.projectName || "").trim().toLowerCase() === String(project?.name || "").trim().toLowerCase();
    });

    const completed = meaningfulTasks.filter((task) => String(task.status || "").toLowerCase() === "completed");
    const failed = meaningfulTasks.filter((task) => String(task.status || "").toLowerCase() === "failed");

    lines.push("## Summary");
    lines.push(`- Recorded work items: ${meaningfulTasks.length}.`);
    lines.push(`- Completed: ${completed.length}.`);
    lines.push(`- Failed: ${failed.length}.`);
    if (Array.isArray(todoState?.checked) && todoState.checked.length) {
      lines.push(`- Todo items checked off: ${todoState.checked.length}.`);
    }
    if (Array.isArray(todoState?.unchecked) && todoState.unchecked.length) {
      lines.push(`- Todo items still open: ${todoState.unchecked.length}.`);
    }
    lines.push("");

    if (Array.isArray(todoState?.checked) && todoState.checked.length) {
      lines.push("## Completed Todo Items");
      for (const entry of todoState.checked.slice(0, 20)) {
        lines.push(`- ${entry}`);
      }
      lines.push("");
    }

    if (Array.isArray(todoState?.unchecked) && todoState.unchecked.length) {
      lines.push("## Remaining Todo Items");
      for (const entry of todoState.unchecked.slice(0, 20)) {
        lines.push(`- ${entry}`);
      }
      lines.push("");
    }

    lines.push("## Work Timeline");
    if (!meaningfulTasks.length) {
      lines.push("- No project-specific task history was recorded before export.");
    } else {
      for (const task of meaningfulTasks.slice(-30)) {
        const status = String(task.status || "unknown").trim();
        const when = formatDateTimeForUser(Number(task.completedAt || task.updatedAt || task.createdAt || 0));
        const summary = compactTaskText(
          String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || task.message || "").trim(),
          260
        ) || "No summary recorded.";
        const brain = String(task.requestedBrainLabel || task.requestedBrainId || "").trim();
        lines.push(`- ${when} | ${task.codename || task.id} | ${status}${brain ? ` | ${brain}` : ""}`);
        lines.push(`  ${summary}`);
      }
    }
    lines.push("");
    lines.push("## Notes");
    lines.push("- This log was generated automatically when the project left the workspace.");
    lines.push("- Review PROJECT-TODO.md alongside this file for the latest task checklist.");
    lines.push("- Review PROJECT-ROLE-TASKS.md for the running per-role task board.");
    lines.push("");
    return lines.join("\n");
  }

  function replaceActiveRolesSectionForCompletedExport(content = "", completedAt = Date.now()) {
    const lines = String(content || "").split(/\r?\n/);
    if (!lines.length) {
      return "";
    }
    const rebuilt = [];
    let insideActiveRoles = false;
    let replaced = false;
    for (const line of lines) {
      if (/^\s*##\s+Active Roles\s*$/i.test(line)) {
        insideActiveRoles = true;
        replaced = true;
        rebuilt.push(line);
        rebuilt.push(`Completed export snapshot on ${new Date(completedAt || Date.now()).toLocaleString("en-AU")}.`);
        rebuilt.push("No active roles remain.");
        continue;
      }
      if (insideActiveRoles) {
        if (/^\s*##\s+/.test(line)) {
          insideActiveRoles = false;
          rebuilt.push(line);
        }
        continue;
      }
      rebuilt.push(line);
    }
    if (!replaced) {
      rebuilt.push("", "## Active Roles", `Completed export snapshot on ${new Date(completedAt || Date.now()).toLocaleString("en-AU")}.`, "No active roles remain.");
    }
    return rebuilt.join("\n");
  }

  function markAllCheckboxesCompleted(content = "") {
    return String(content || "").replace(/^(\s*[-*]\s+\[)\s(\]\s+.+)$/gm, "$1x$2");
  }

  async function cleanupReadyExportArtifacts(targetPath = "", { completedAt = Date.now() } = {}) {
    const normalizedTargetPath = String(targetPath || "").trim();
    if (!normalizedTargetPath) {
      return;
    }
    const roleTaskPath = path.join(normalizedTargetPath, "PROJECT-ROLE-TASKS.md");
    const todoPath = path.join(normalizedTargetPath, "PROJECT-TODO.md");

    const roleTaskContent = await fs.readFile(roleTaskPath, "utf8").catch(() => "");
    if (roleTaskContent) {
      const cleanedRoleTaskContent = replaceActiveRolesSectionForCompletedExport(
        markAllCheckboxesCompleted(roleTaskContent),
        completedAt
      );
      await fs.writeFile(roleTaskPath, cleanedRoleTaskContent.endsWith("\n") ? cleanedRoleTaskContent : `${cleanedRoleTaskContent}\n`, "utf8");
    }

    const todoContent = await fs.readFile(todoPath, "utf8").catch(() => "");
    if (todoContent) {
      const cleanedTodoContent = markAllCheckboxesCompleted(todoContent);
      await fs.writeFile(todoPath, cleanedTodoContent.endsWith("\n") ? cleanedTodoContent : `${cleanedTodoContent}\n`, "utf8");
    }
  }

  function normalizeProjectIdentity(value = "") {
    return normalizeSummaryComparisonText(String(value || "").trim());
  }

  function extractDeclaredProjectNameFromTask(task = {}) {
    const text = [
      String(task?.message || ""),
      String(task?.originalMessage || "")
    ].join("\n");
    const match = text.match(/\badvance the project\s+(.+?)\s+in\s+/i);
    return normalizeProjectIdentity(match?.[1] || "");
  }

  function isProjectCycleLikeTask(task = {}) {
    const internalJobType = String(task?.internalJobType || "").trim();
    const sessionId = String(task?.sessionId || "").trim();
    return internalJobType === "project_cycle"
      || internalJobType === "task_maintenance"
      || sessionId === "project-cycle"
      || sessionId === "task-maintenance";
  }

  function isCompletedProjectCycleLikeTask(task = {}) {
    const status = String(task?.status || "").trim().toLowerCase();
    const closedFromStatus = String(task?.closedFromStatus || "").trim().toLowerCase();
    const settledClosedTask = status === "closed"
      && String(task?.maintenanceDecision || "").trim().toLowerCase() === "closed"
      && /\bsettled\b/i.test(String(task?.maintenanceReason || task?.notes || ""))
      && Boolean(String(task?.resultSummary || task?.reviewSummary || task?.workerSummary || "").trim());
    return status === "completed" || closedFromStatus === "completed" || settledClosedTask;
  }

  function getTaskCompletionTimestamp(task = {}) {
    return Number(task?.completedAt || task?.updatedAt || task?.createdAt || 0);
  }

  function isTaskAlignedWithProject(task = {}, project = {}) {
    const targetName = normalizeProjectIdentity(project?.name || "");
    const targetPath = normalizeProjectIdentity(project?.path || "");
    const explicitTaskProjectName = normalizeProjectIdentity(task?.projectName || "");
    const declaredProjectName = extractDeclaredProjectNameFromTask(task);

    if (targetName && explicitTaskProjectName && explicitTaskProjectName !== targetName) {
      return false;
    }
    if (targetName && declaredProjectName && declaredProjectName !== targetName) {
      return false;
    }

    if (targetName && (explicitTaskProjectName === targetName || declaredProjectName === targetName)) {
      return true;
    }

    const evidenceText = normalizeProjectIdentity([
      String(task?.message || ""),
      String(task?.originalMessage || ""),
      String(task?.notes || ""),
      String(task?.resultSummary || ""),
      String(task?.reviewSummary || ""),
      String(task?.workerSummary || "")
    ].join("\n"));

    if (targetPath && evidenceText.includes(targetPath)) {
      return true;
    }
    if (targetName && evidenceText.includes(targetName)) {
      return true;
    }
    return false;
  }

  function hasPositiveProjectCompletionEvidence(todoState = {}, projectTasks = [], project = {}) {
    if (Array.isArray(todoState?.unchecked) && todoState.unchecked.length) {
      return false;
    }
    const workstreamLabel = String(todoState?.assessment?.workstreamLabel || "").trim().toLowerCase();
    const isResearchTrack = /\bresearch\b/.test(workstreamLabel);
    const hasCheckedTodo = Array.isArray(todoState?.checked) && todoState.checked.length > 0;
    const hasMeaningfulCheckedTodo = Array.isArray(todoState?.checked) && todoState.checked.some((item) => {
      const normalized = String(item || "").trim();
      if (!normalized) {
        return false;
      }
      if (/^complete the unchecked directive item in\b/i.test(normalized)) {
        return false;
      }
      if (/^complete the directive objective in\b/i.test(normalized)) {
        return false;
      }
      return !isTemplateTodoItem(normalized);
    });
    const directiveCompleted = Boolean(todoState?.directiveCompleted);
    const alignedProjectTasks = Array.isArray(projectTasks)
      ? projectTasks.filter((task) => isProjectCycleLikeTask(task) && isTaskAlignedWithProject(task, project))
      : [];
    const hasCompletedProjectTask = alignedProjectTasks.some((task) => isCompletedProjectCycleLikeTask(task));
    const latestCompletedAt = alignedProjectTasks
      .filter((task) => isCompletedProjectCycleLikeTask(task))
      .reduce((max, task) => Math.max(max, getTaskCompletionTimestamp(task)), 0);
    const latestFailedAt = alignedProjectTasks
      .filter((task) => String(task?.status || "").trim().toLowerCase() === "failed")
      .reduce((max, task) => Math.max(max, getTaskCompletionTimestamp(task)), 0);
    if (latestFailedAt > latestCompletedAt) {
      return false;
    }
    if (isResearchTrack && (hasCheckedTodo || directiveCompleted) && !hasMeaningfulCheckedTodo) {
      return false;
    }
    return (hasCheckedTodo || directiveCompleted) && hasCompletedProjectTask;
  }

  function shouldQueueExportRequirementsPass(todoState = {}, projectTasks = [], project = {}) {
    const hasUnchecked = Array.isArray(todoState?.unchecked) && todoState.unchecked.length > 0;
    if (hasUnchecked) {
      return false;
    }
    const hasCheckedTodo = Array.isArray(todoState?.checked) && todoState.checked.length > 0;
    const directiveCompleted = Boolean(todoState?.directiveCompleted);
    if (!hasCheckedTodo && !directiveCompleted) {
      return false;
    }
    return !hasPositiveProjectCompletionEvidence(todoState, projectTasks, project);
  }

  async function exportWorkspaceProjectToOutput(project, { ready = false } = {}) {
    if (!project?.name || !project?.path) {
      return null;
    }
    const todoState = await ensureProjectTodoForWorkspaceProject(project).catch(() => ({ checked: [], unchecked: [] }));
    const projectTasks = await listHistoricalProjectTasks(project).catch(() => []);
    const exportLogContent = buildProjectExportLogContent(project, todoState, projectTasks);
    const folder = ready ? "projects-ready" : "workspace-archive";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetRoot = `${OBSERVER_CONTAINER_OUTPUT_ROOT}/${folder}/${stamp}`;
    const targetName = sanitizeWorkspaceProjectName(project.name);
    await writeContainerTextFile(`${String(project.path)}/PROJECT-WORK-LOG.md`, `${exportLogContent}\n`, { timeoutMs: 30000 });
    const movedProject = await moveWorkspaceProjectToOutput(project, { targetName, targetRoot, timeoutMs: 120000 });
    if (ready) {
      await cleanupReadyExportArtifacts(String(movedProject?.targetPath || "").trim(), {
        completedAt: Date.now()
      }).catch(() => null);
    }
    return {
      ...movedProject,
      ready
    };
  }

  function getProjectBackupStateKey(project = {}) {
    const name = String(project?.name || project?.projectName || "").trim().toLowerCase();
    const projectPath = String(project?.path || project?.destination || "").trim().toLowerCase();
    return name || projectPath;
  }

  function formatProjectBackupLabel(reason = "snapshot", at = Date.now()) {
    const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
    const suffix = String(reason || "snapshot")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "snapshot";
    return `${stamp}-${suffix}`;
  }

  async function backupWorkspaceProjectSnapshot(project, { reason = "periodic", force = false } = {}) {
    const projectConfig = getProjectConfig();
    if (projectConfig.autoBackupWorkspaceProjects === false) {
      return null;
    }
    const projectName = String(project?.name || project?.projectName || "").trim();
    const projectPath = String(project?.path || project?.destination || "").trim();
    if (!projectName || !projectPath) {
      return null;
    }
    const stateKey = getProjectBackupStateKey(project);
    const previous = stateKey ? opportunityScanState.projectRotation?.backups?.[stateKey] || {} : {};
    const now = Date.now();
    const modifiedAt = Number(project?.modifiedAt || 0);
    const unchanged = modifiedAt > 0 && Number(previous.projectModifiedAt || 0) >= modifiedAt;
    const withinInterval = Number(previous.lastBackupAt || 0) > 0
      && now - Number(previous.lastBackupAt || 0) < projectConfig.projectBackupIntervalMs;
    if (!force && (unchanged || withinInterval)) {
      return null;
    }
    const targetRoot = `${OBSERVER_CONTAINER_OUTPUT_ROOT}/project-backups/${sanitizeWorkspaceProjectName(projectName)}`;
    const snapshot = await snapshotWorkspaceProjectToOutput({
      name: projectName,
      path: projectPath
    }, {
      targetName: formatProjectBackupLabel(reason, now),
      targetRoot,
      timeoutMs: 120000
    });
    if (stateKey) {
      opportunityScanState.projectRotation.backups[stateKey] = {
        lastBackupAt: now,
        projectModifiedAt: modifiedAt || now,
        lastTargetPath: String(snapshot?.targetPath || "").trim(),
        lastReason: String(reason || "").trim()
      };
    }
    return snapshot;
  }

  async function chooseRepositoryProjectForImport({ excludeSourceNames = [], excludeTargetNames = [] } = {}) {
    const repoRoot = OBSERVER_INPUT_HOST_ROOT;
    const recentImports = opportunityScanState.projectRotation?.recentImports || {};
    const excludedSource = new Set((Array.isArray(excludeSourceNames) ? excludeSourceNames : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    const excludedTarget = new Set((Array.isArray(excludeTargetNames) ? excludeTargetNames : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    let entries = [];
    try {
      entries = await fs.readdir(repoRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourceName = String(entry.name || "").trim();
      const targetName = sanitizeWorkspaceProjectName(sourceName);
      if (!sourceName || !targetName) continue;
      if (excludedSource.has(sourceName.toLowerCase()) || excludedTarget.has(targetName.toLowerCase())) continue;
      const fullPath = path.join(repoRoot, entry.name);
      if (!(await hostDirectoryLooksLikeImportableProject(fullPath, sourceName))) continue;
      try {
        const stat = await fs.stat(fullPath);
        candidates.push({
          sourceName,
          targetName,
          hostPath: fullPath,
          modifiedAt: Number(stat.mtimeMs || 0),
          recentAt: Number(recentImports[sourceName] || 0)
        });
      } catch {
        continue;
      }
    }
    candidates.sort((a, b) => {
      if (a.recentAt !== b.recentAt) return a.recentAt - b.recentAt;
      return b.modifiedAt - a.modifiedAt;
    });
    return candidates[0] || null;
  }

  async function rotateWorkspaceProjectFromRepositories() {
    const workspaceProjects = await listContainerWorkspaceProjects();
    if (workspaceProjects.length) {
      return {
        archivedProjects: [],
        importedProject: null
      };
    }
    const nextProject = await chooseRepositoryProjectForImport();
    if (!nextProject) {
      return {
        archivedProjects: [],
        importedProject: null
      };
    }
    const importedProject = await importRepositoryProjectToWorkspace(nextProject);
    if (importedProject?.sourceName) {
      opportunityScanState.projectRotation.recentImports[importedProject.sourceName] = Date.now();
    }
    await backupWorkspaceProjectSnapshot({
      name: importedProject?.projectName,
      path: importedProject?.destination,
      modifiedAt: importedProject?.modifiedAt || Date.now()
    }, { reason: "import", force: true }).catch(() => null);
    return {
      archivedProjects: [],
      importedProject
    };
  }

  async function fillWorkspaceProjectsFromRepositories(targetCount = 1) {
    const desiredCount = Math.max(0, Number(targetCount || 0));
    const workspaceProjects = await listContainerWorkspaceProjects();
    const importedProjects = [];
    const existingTargetNames = new Set(workspaceProjects.map((entry) => sanitizeWorkspaceProjectName(String(entry.name || "").trim()).toLowerCase()).filter(Boolean));
    const importedSourceNames = new Set();
    while (workspaceProjects.length + importedProjects.length < desiredCount) {
      const nextProject = await chooseRepositoryProjectForImport({
        excludeSourceNames: [...importedSourceNames],
        excludeTargetNames: [...existingTargetNames, ...importedProjects.map((entry) => String(entry.projectName || "").trim().toLowerCase())]
      });
      if (!nextProject) {
        break;
      }
      const importedProject = await importRepositoryProjectToWorkspace(nextProject);
      if (!importedProject) {
        break;
      }
      importedProjects.push(importedProject);
      if (importedProject.sourceName) {
        opportunityScanState.projectRotation.recentImports[importedProject.sourceName] = Date.now();
      }
      await backupWorkspaceProjectSnapshot({
        name: importedProject?.projectName,
        path: importedProject?.destination,
        modifiedAt: importedProject?.modifiedAt || Date.now()
      }, { reason: "import", force: true }).catch(() => null);
      importedSourceNames.add(String(nextProject.sourceName || "").trim().toLowerCase());
      existingTargetNames.add(String(importedProject.projectName || "").trim().toLowerCase());
    }
    return importedProjects;
  }

  async function countActiveProjectCycleTasks(projectName = "", ignoreTaskId = "", taskCache = null) {
    const target = String(projectName || "").trim().toLowerCase();
    const ignored = String(ignoreTaskId || "").trim();
    if (!target) {
      return 0;
    }
    const { queued, inProgress } = taskCache || await listAllTasks();
    return [...queued, ...inProgress].filter((task) =>
      String(task.id || "") !== ignored
      && String(task.internalJobType || "") === "project_cycle"
      && String(task.projectName || "").trim().toLowerCase() === target
    ).length;
  }

  function isTemplateTodoItem(text = "") {
    const n = String(text || "").trim();
    return /\bupdate this todo file after each (work pass|pass)\b/i.test(n)
      || /\bmake one concrete improvement that advances\b/i.test(n)
      || /\breview the project structure and identify\b/i.test(n)
      || /\bpreserve continuity, voice, tense\b/i.test(n)
      || /\bstrengthen the manuscript, outline, or current scene\b/i.test(n)
      || /\bcreate a directive\.md\b/i.test(n)
      || /\bwork through the most important existing todo or fixme\b/i.test(n)
      || /\badd or improve lightweight test coverage\b/i.test(n)
      || /\binspect the package scripts\b/i.test(n)
      || /\bidentify the best (runnable or shippable|shippable story|shippable) next step\b/i.test(n);
  }

  function normalizeCreativeThroughputMode(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    return ["conservative", "auto", "fast"].includes(normalized) ? normalized : "auto";
  }

  function isPlanningProjectDocument(filePath = "") {
    return /(^|\/)(directive|project-todo|project-role-tasks|readme)\.md$/i.test(String(filePath || "").trim());
  }

  function isNarrativeProjectDocument(filePath = "") {
    const normalized = String(filePath || "").trim();
    if (!normalized || isPlanningProjectDocument(normalized) || !/\.(md|txt)$/i.test(normalized)) {
      return false;
    }
    return /\b(act|chapter|scene|manuscript|outline|story|draft|character|world|lore|ritual|profile|arc)\b/i.test(normalized);
  }

  function getCreativeCanonReferenceFiles(inspection = {}) {
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const scored = files
      .map((file) => {
        const normalized = String(file || "").trim();
        const lower = normalized.toLowerCase();
        if (!normalized || isPlanningProjectDocument(normalized) || !/\.(md|txt)$/i.test(lower)) {
          return null;
        }
        let score = 0;
        if (/(^|\/)(project-canon|story-bible|continuity|continuity[_-]?notes?|characters?|character[_-]?sheet|world|world-building|lore|mechanics|magic|style|tone|project-status)\b/i.test(lower)) score += 120;
        if (/(^|\/)(readme|briefing|research-brief)\.md$/i.test(lower)) score += 70;
        if (/(^|\/)(outline|journey|chapter[-_ ]?outline|act[-_ ]?outline)\b/i.test(lower)) score += 55;
        if (/(^|\/)(chapters?|scenes?|drafts?)\//i.test(lower)) score -= 20;
        if (/\b(final|current|latest|canonical|canon)\b/i.test(lower)) score += 35;
        return score > 0 ? { file: normalized, score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(left.file || "").localeCompare(String(right.file || ""));
      });
    return scored.map((entry) => entry.file).slice(0, 5);
  }

  function buildCreativeContinuityGuard(project = {}, todoState = {}, targets = {}) {
    const inspection = todoState?.inspection || {};
    const canonFiles = getCreativeCanonReferenceFiles(inspection);
    const targetFiles = [
      String(targets?.primaryTarget || "").trim(),
      String(targets?.secondaryTarget || "").trim(),
      String(targets?.tertiaryTarget || "").trim()
    ].filter(Boolean);
    const canonLine = canonFiles.length
      ? `Creative continuity guard: treat these files as canon before changing prose: ${canonFiles.map((file) => `${project.path}/${file}`).join(", ")}.`
      : "Creative continuity guard: infer canon from the existing README, outline, character, world, and current chapter files before changing prose.";
    const targetLine = targetFiles.length
      ? `Stay on the named target file(s): ${targetFiles.map((file) => `${project.path}/${file}`).join(", ")}.`
      : "Choose one existing narrative target and edit it in place.";
    return [
      canonLine,
      `${targetLine} Do not create a new protagonist, setting, magic system, chapter sequence, alternate draft file, or parallel book unless the objective explicitly asks for a branch.`,
      "If the named target conflicts with canon, repair the target toward the canon or record the conflict in PROJECT-TODO.md instead of expanding the contradiction."
    ];
  }

  async function buildCreativeFragmentContextPromptLines(project = {}, { proseLimit = 8, shortlistLimit = 40 } = {}) {
    if (typeof buildProjectFragmentContext !== "function") {
      return {
        lines: [],
        blockCount: 0,
        fragmentCount: 0
      };
    }
    const context = await buildProjectFragmentContext({
      projectName: String(project?.name || "").trim(),
      projectPath: String(project?.path || "").trim(),
      proseLimit,
      shortlistLimit
    }).catch(() => null);
    const text = String(context?.text || "").trim();
    const summary = context?.summary && typeof context.summary === "object" ? context.summary : {};
    const fragmentCount = Number(summary.totalCount || 0);
    if (!text || !fragmentCount) {
      return {
        lines: [
          "Project fragment memory: no project fragments are recorded yet. If this pass establishes reusable character, lore, guideline, summary, or prose continuity, save it with save_project_fragment."
        ],
        blockCount: 0,
        fragmentCount: 0
      };
    }
    const clipped = compactTaskText(text, 5200);
    return {
      lines: [
        `Project fragment memory: ${fragmentCount} fragment${fragmentCount === 1 ? "" : "s"} recorded, ${Number(summary.stickyCount || 0)} sticky, ${Number(summary.proseSectionCount || 0)} prose section${Number(summary.proseSectionCount || 0) === 1 ? "" : "s"}.`,
        "Use this fragment memory as continuity context before changing creative prose, character sheets, lore, summaries, or guidelines. Prefer updating existing fragments over creating duplicates.",
        clipped
      ],
      blockCount: Array.isArray(context?.blocks) ? context.blocks.length : 0,
      fragmentCount
    };
  }

  function focusLooksLikeCreativeRepairOrPlanning(focus = "") {
    return /\b(readme|directive|project-todo|project-role-tasks|todo|fixme|package|script|test|coverage|accessibility|wcag|css|ui|export|blocker|compliance|repair|restore|recover|corrupt)\b/i.test(String(focus || "").trim());
  }

  function focusLooksLikeDirectCreativeWriting(focus = "") {
    const normalized = String(focus || "").trim();
    if (!normalized || focusLooksLikeCreativeRepairOrPlanning(normalized)) {
      return false;
    }
    return /\b(draft|write|rewrite|redraft|revise|revision|expand|polish|tighten|line edit|developmental|scene|chapter|act|manuscript|outline|dialogue|prose|voice|pacing|interiority|worldbuild|worldbuilding|character)\b/i.test(normalized);
  }

  function focusLooksLikeResearchSynthesis(focus = "") {
    return /\b(research|scientific|science|literature review|evidence synthesis|peer[- ]reviewed|citations?|references|study|studies|journal|paper|papers|methodology|hypothesis|analysis|dataset|biology|biological|biochem(?:istry)?|chemistry|chemical|metabolic|pathway|pathways|genetic|genomics|proteomics|clinical|bioinformatics)\b/i.test(String(focus || "").trim());
  }

  function focusLooksLikeSensitiveBioChemDesign(focus = "") {
    return /\b(metabolic pathways?|pathway design|biological pathway|bioengineering|synthetic biology|gene editing|pathogen|toxin|viral|virus|culture conditions?|lab protocol|wet lab|optimi[sz]e yield|optimi[sz]ing yield)\b/i.test(String(focus || "").trim());
  }

  function buildCreativeThroughputTaskFlags({ specialtyHint = "", entry = {}, targets = {}, projectConfig = {} } = {}) {
    const mode = normalizeCreativeThroughputMode(projectConfig?.creativeThroughputMode);
    if (String(specialtyHint || "").trim().toLowerCase() !== "creative") {
      return {
        creativeThroughputMode: "",
        preferHigherThroughputCreativeLane: false,
        skipCreativeHandoff: false
      };
    }
    const focus = String(entry?.focus || "").trim();
    const roleName = String(entry?.roleName || "").trim();
    const source = String(entry?.source || "").trim().toLowerCase();
    const primaryTarget = String(targets?.primaryTarget || entry?.preferredTarget || "").trim();
    const narrativeTarget = isNarrativeProjectDocument(primaryTarget);
    const riskyFocus = focusLooksLikeCreativeRepairOrPlanning(focus);
    const directWritingFocus = focusLooksLikeDirectCreativeWriting(focus);
    const roleSupportsFastPath = FAST_CREATIVE_ROLE_NAMES.has(roleName);
    const safeFastPath = narrativeTarget
      && source !== "directive"
      && !isPlanningProjectDocument(primaryTarget)
      && !riskyFocus
      && (mode === "fast" ? (directWritingFocus || roleSupportsFastPath) : directWritingFocus);
    return {
      creativeThroughputMode: mode,
      preferHigherThroughputCreativeLane: safeFastPath,
      skipCreativeHandoff: safeFastPath
    };
  }

  function buildProjectWorkPackages(project, todoState, limit = getProjectConfig().maxActiveWorkPackagesPerProject) {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (source, focus, preferredTarget = "", role = null) => {
      if (candidates.length >= limit) {
        return;
      }
      const normalizedFocus = compactTaskText(String(focus || "").trim(), 220);
      if (!normalizedFocus) {
        return;
      }
      const placeholderFocus = normalizeSummaryComparisonText(normalizedFocus);
      if (placeholderFocus === "none" || placeholderFocus === "n a" || placeholderFocus === "na") {
        return;
      }
      const dedupeKey = normalizeSummaryComparisonText(normalizedFocus);
      if (!dedupeKey || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      candidates.push({
        source,
        focus: normalizedFocus,
        preferredTarget: String(preferredTarget || "").trim(),
        key: `project-cycle:${String(project?.name || "").trim().toLowerCase()}:${hashRef(`${source}|${dedupeKey}`)}`,
        roleName: compactTaskText(String(role?.name || "").trim(), 120),
        rolePlaybook: compactTaskText(String(role?.playbook || "").trim(), 220),
        roleReason: compactTaskText(String(role?.reason || "").trim(), 180)
      });
    };
    const directiveEntries = Array.isArray(todoState?.directiveState?.uncheckedItems)
      ? todoState.directiveState.uncheckedItems
      : [];
    if (directiveEntries.length) {
      for (const item of directiveEntries) {
        pushCandidate(
          "directive",
          item?.focus,
          item?.preferredTarget || todoState?.directiveState?.path,
          resolveProjectRoleForFocus(todoState, item?.focus)
        );
      }
      return candidates.slice(0, Math.max(1, limit));
    }
    for (const item of Array.isArray(todoState?.unchecked) ? todoState.unchecked : []) {
      pushCandidate("todo", item, "", resolveProjectRoleForFocus(todoState, item));
    }
    const projectSpecialty = inferProjectCycleSpecialty(project, todoState, "");
    const activeRoleNames = new Set(
      (Array.isArray(todoState?.activeRoles) ? todoState.activeRoles : [])
        .map((entry) => String(entry?.name || "").trim())
        .filter(Boolean)
    );
    const creativeRoleNames = new Set([
      "Story Architect", "Developmental Editor", "Line Editor",
      "Continuity Editor", "Character Writer", "Worldbuilding Designer"
    ]);
    const selectedRoleReports = (Array.isArray(todoState?.roleReports) ? todoState.roleReports : [])
      .filter((entry) => {
        const roleName = String(entry?.name || "").trim();
        const status = String(entry?.status || "").trim().toLowerCase();
        if (!roleName) {
          return false;
        }
        if (activeRoleNames.size) {
          return activeRoleNames.has(roleName);
        }
        return entry?.selected || ["active", "planned"].includes(status);
      })
      .filter((entry) => projectSpecialty !== "creative" || creativeRoleNames.has(String(entry?.name || "").trim()));
    for (const report of selectedRoleReports) {
      const roleMeta = {
        name: report?.name,
        playbook: report?.playbook,
        reason: report?.reason
      };
      for (const item of Array.isArray(report?.unchecked) ? report.unchecked : []) {
        pushCandidate("role", item, "", roleMeta);
      }
    }
    for (const item of Array.isArray(todoState?.roleUnchecked) ? todoState.roleUnchecked : []) {
      const roleMeta = resolveProjectRoleForFocus(todoState, item);
      if (activeRoleNames.size && (!roleMeta?.name || !activeRoleNames.has(String(roleMeta.name || "").trim()))) {
        continue;
      }
      pushCandidate("role", item, "", roleMeta);
    }
    if (!candidates.length && todoState?.exportRequirementsMode) {
      const exportRequirementsFocus = buildExportRequirementsFocus(project, todoState);
      pushCandidate(
        "export_requirements",
        exportRequirementsFocus,
        String(todoState?.directiveState?.path || "").trim(),
        resolveProjectRoleForFocus(
          {
            ...todoState,
            unchecked: [
              exportRequirementsFocus
            ]
          },
          exportRequirementsFocus
        )
      );
    }
    candidates.sort((a, b) => {
      const aTemplate = isTemplateTodoItem(a.focus) ? 1 : 0;
      const bTemplate = isTemplateTodoItem(b.focus) ? 1 : 0;
      return aTemplate - bTemplate;
    });
    return candidates.slice(0, Math.max(1, limit));
  }

  function scoreProjectWorkTarget(file = "", focus = "") {
    const normalizedFile = String(file || "").trim().toLowerCase();
    const normalizedFocus = String(focus || "").trim().toLowerCase();
    if (!normalizedFile) {
      return 0;
    }
    let score = 0;
    const basename = normalizedFile.split("/").pop() || normalizedFile;
    const isCodeFile = /\.(js|jsx|ts|tsx|mjs|cjs|py|php|rb|go|rs|java|cs|cpp|c)$/i.test(basename);
    const isTestFile = /(^|[./_-])(test|tests|spec)([./_-]|$)/i.test(basename);
    const isMarkdownFile = /\.md$/i.test(basename);
    if (normalizedFocus.includes(basename)) score += 120;
    if (basename === WORKSPACE_PROJECT_MARKER_FILE.toLowerCase()) score -= 120;
    if (/\boutline\b/.test(basename) && /\b(outline|chapter|arc)\b/.test(normalizedFocus)) score += 100;
    if (/\bmanuscript\b/.test(basename) && /\b(manuscript|voice|pacing|scene|transition|front matter|end matter|reading copy)\b/.test(normalizedFocus)) score += 100;
    if (/\bdeliverable-spec\b/.test(basename) && /\b(pdf|export|deliverable|blocker)\b/.test(normalizedFocus)) score += 100;
    if (/app\.js$/.test(basename) && /\b(app|validation|feedback|localstorage|storage|completed-state|clear-completed|daily reset)\b/.test(normalizedFocus)) score += 100;
    if (/\.css$/.test(basename) && /\b(layout|typography|style|polish|visual)\b/.test(normalizedFocus)) score += 100;
    if (/\.html$/.test(basename) && /\b(empty state|first-run|guidance|markup|semantics|accessibility)\b/.test(normalizedFocus)) score += 100;
    if (/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z)$/.test(basename) && /\b(zip|unzip|archive|extract|unpack|intake)\b/.test(normalizedFocus)) score += 130;
    if (/^directive\.md$/.test(basename) && /\b(directive|checkbox|check this box|tick|mark complete|completed directive state)\b/.test(normalizedFocus)) score += 140;
    if (/\b(test|tests|spec|assert|verify|verification|coverage)\b/.test(normalizedFocus) && isTestFile) score += 110;
    if (/\b(readme|docs|documentation|guide|usage|example)\b/.test(normalizedFocus) && /^readme\.md$/.test(basename)) score += 120;
    if (/\b(readme|docs|documentation|guide|usage|example)\b/.test(normalizedFocus) && isMarkdownFile) score += 40;
    if (/\b(package|npm|script|dependency|dependencies)\b/.test(normalizedFocus) && /^package\.json$/.test(basename)) score += 80;
    if (/\b(summary|flag|cli|command|duration|preset|timer|logic|behavior|implement|implementation|fix|bug|feature)\b/.test(normalizedFocus) && isCodeFile) score += 60;
    if (/project-role-tasks\.md$/.test(basename)) score -= 20;
    if (/project-todo\.md$/.test(basename)) score -= 10;
    if (/readme\.md$/.test(basename)) score += 10;
    return score;
  }

  function chooseProjectWorkTargets(project, todoState, focus = "", { preferredTarget = "" } = {}) {
    const inspection = todoState?.inspection || {};
    const files = Array.isArray(inspection?.files) ? inspection.files : [];
    const candidateFiles = files.filter((file) => {
      const basename = String(file || "").trim().split("/").pop() || "";
      return basename.toLowerCase() !== WORKSPACE_PROJECT_MARKER_FILE.toLowerCase();
    });
    const effectiveFiles = candidateFiles.length ? candidateFiles : files;
    const normalizedPreferredTarget = String(preferredTarget || "").trim().startsWith(`${String(project?.path || "").trim()}/`)
      ? String(preferredTarget || "").trim().slice(String(project?.path || "").trim().length + 1)
      : String(preferredTarget || "").trim();
    const ranked = effectiveFiles
      .map((file) => ({ file, score: scoreProjectWorkTarget(file, focus) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(left.file || "").localeCompare(String(right.file || ""));
      });
    const preferredMatch = effectiveFiles.find((file) => String(file || "").trim() === normalizedPreferredTarget);
    const primary = preferredMatch || ranked[0]?.file || pickInspectionFile({
      ...inspection,
      files: effectiveFiles
    }, [/\.js$/i, /\.css$/i, /\.html$/i, /\.md$/i]);
    const secondary = ranked.find((entry) => entry.file !== primary)?.file
      || effectiveFiles.find((file) => file !== primary)
      || "";
    const tertiary = ranked.find((entry) => entry.file !== primary && entry.file !== secondary)?.file
      || effectiveFiles.find((file) => file !== primary && file !== secondary)
      || "";
    return {
      primaryTarget: primary,
      secondaryTarget: secondary,
      tertiaryTarget: tertiary,
      expectedFirstMove: primary
        ? `Read ${project.path}/${primary} before deciding on further edits.`
        : `List ${project.path} and inspect one concrete implementation file before deciding on further edits.`
    };
  }

  async function findTaskByProjectWorkKey(projectWorkKey = "", taskCache = null) {
    const key = String(projectWorkKey || "").trim();
    if (!key) {
      return null;
    }
    const { queued, waiting, inProgress } = taskCache || await listAllTasks();
    return [...queued, ...(waiting || []), ...inProgress].find((task) => String(task.projectWorkKey || "") === key) || null;
  }

  async function listClosedTasksForProjectAttemptAccounting(taskCache = null) {
    if (Array.isArray(taskCache?.closed)) {
      return taskCache.closed;
    }
    if (!TASK_QUEUE_CLOSED || typeof listTasksByFolder !== "function") {
      return [];
    }
    return await listTasksByFolder(TASK_QUEUE_CLOSED, "closed").catch(() => []);
  }

  function getProjectWorkAttemptCooldownMs(task = {}, cooldownMs = getProjectConfig().projectWorkRetryCooldownMs) {
    const configured = Math.max(0, Number(cooldownMs || 0));
    if (String(task?.status || "").trim() === "failed") {
      const scanIntervalMs = Math.max(10000, Number(getProjectConfig().opportunityScanIntervalMs || 60000));
      return Math.min(configured, 2 * scanIntervalMs);
    }
    return configured;
  }

  async function findRecentProjectWorkAttempt(projectWorkKey = "", cooldownMs = getProjectConfig().projectWorkRetryCooldownMs, ignoredTaskId = "", taskCache = null) {
    const key = String(projectWorkKey || "").trim();
    if (!key) {
      return null;
    }
    const ignored = String(ignoredTaskId || "").trim();
    const now = Date.now();
    const { done = [], failed = [] } = taskCache || await listAllTasks();
    const closed = await listClosedTasksForProjectAttemptAccounting(taskCache);
    return [...failed, ...done, ...closed]
      .filter((task) => String(task.id || "") !== ignored)
      .filter((task) => String(task.projectWorkKey || "") === key)
      .filter((task) => {
        const completedAt = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
        return completedAt >= now - getProjectWorkAttemptCooldownMs(task, cooldownMs);
      })
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))[0] || null;
  }

  async function findRecentProjectCycleMessageAttempt(message = "", cooldownMs = getProjectConfig().projectWorkRetryCooldownMs, ignoredTaskId = "", taskCache = null) {
    const normalizedMessage = normalizeSummaryComparisonText(String(message || "").trim());
    if (!normalizedMessage) {
      return null;
    }
    const ignored = String(ignoredTaskId || "").trim();
    const now = Date.now();
    const resolvedTaskCache = taskCache || await listAllTasks();
    const { done = [], failed = [] } = resolvedTaskCache;
    const closed = await listClosedTasksForProjectAttemptAccounting(resolvedTaskCache);
    return [...failed, ...done, ...closed]
      .filter((task) => String(task.id || "") !== ignored)
      .filter((task) => String(task.sessionId || "").trim() === "project-cycle")
      .filter((task) => normalizeSummaryComparisonText(String(task.message || "").trim()) === normalizedMessage)
      .filter((task) => {
        const completedAt = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
        return completedAt >= now - getProjectWorkAttemptCooldownMs(task, cooldownMs);
      })
      .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))[0] || null;
  }

  async function countFailedProjectWorkAttempts(projectWorkKey = "", taskCache = null) {
    const key = String(projectWorkKey || "").trim();
    if (!key) {
      return 0;
    }
    const { failed = [] } = taskCache || await listAllTasks();
    const closed = await listClosedTasksForProjectAttemptAccounting(taskCache);
    return [...failed, ...closed].filter((task) =>
      String(task.projectWorkKey || "") === key
      && String(task.status || "").trim().toLowerCase() === "failed"
    ).length;
  }

  async function countRecentProjectCycleFailures(projectName = "", windowMs = 3 * 60 * 60 * 1000) {
    const name = String(projectName || "").trim().toLowerCase();
    if (!name) return 0;
    const now = Date.now();
    const taskCache = await listAllTasks();
    const closed = await listClosedTasksForProjectAttemptAccounting(taskCache);
    return [...(taskCache.failed || []), ...closed].filter((task) => {
      if (String(task?.sessionId || "").trim() !== "project-cycle") return false;
      if (String(task?.status || "").trim().toLowerCase() !== "failed") return false;
      if (String(task?.projectName || "").trim().toLowerCase() !== name) return false;
      const completedAt = Number(task.completedAt || task.updatedAt || task.createdAt || 0);
      return completedAt >= now - windowMs;
    }).length;
  }

  async function queueWorkspaceProjectCycleTasks(project, todoState, limit = getProjectConfig().maxActiveWorkPackagesPerProject) {
    const projectConfig = getProjectConfig();
    const observerConfig = getObserverConfig() || {};
    const minConcreteTargets = projectConfig.noChangeMinimumConcreteTargets;
    const projectAssessment = typeof buildProjectAssessment === "function"
      ? buildProjectAssessment(project, todoState?.inspection || {}, todoState?.directiveState || {}, { todoState })
      : null;
    const projectSpecialty = inferProjectCycleSpecialty(project, todoState, "");
    const effectiveMaxActiveWorkPackages = projectSpecialty === "creative"
      ? 1
      : projectConfig.maxActiveWorkPackagesPerProject;
    const taskCache = await listAllTasks();
    taskCache.closed = await listClosedTasksForProjectAttemptAccounting(taskCache);
    const activeCount = await countActiveProjectCycleTasks(project.name, "", taskCache);
    if (activeCount >= effectiveMaxActiveWorkPackages) {
      return [];
    }
    const remainingSlots = Math.max(0, Math.min(limit, effectiveMaxActiveWorkPackages) - activeCount);
    if (!remainingSlots) {
      return [];
    }
    const candidatePoolLimit = remainingSlots + Math.min(6, Math.max(2, remainingSlots));
    const packages = buildProjectWorkPackages(project, todoState, candidatePoolLimit);
    const implementationRoot = getProjectImplementationRoot(project, todoState?.inspection);
    const created = [];
    for (const entry of packages) {
      if (created.length >= remainingSlots) {
        break;
      }
      if (await findTaskByProjectWorkKey(entry.key, taskCache)) {
        continue;
      }
      if (await findRecentProjectWorkAttempt(entry.key, undefined, "", taskCache)) {
        continue;
      }
      const failedCount = await countFailedProjectWorkAttempts(entry.key, taskCache);
      if (failedCount >= projectConfig.projectWorkMaxRetries) {
        continue;
      }
      const specialtyHint = inferProjectCycleSpecialty(project, todoState, entry.focus)
        || inferTaskSpecialty({ message: entry.focus, internalJobType: "project_cycle" })
        || "general";
      const preferredWorker = await chooseIdleWorkerBrainForSpecialty(specialtyHint);
      const targets = chooseProjectWorkTargets(project, todoState, entry.focus, { preferredTarget: entry.preferredTarget });
      const researchSynthesisFocus = specialtyHint === "retrieval" || focusLooksLikeResearchSynthesis(entry.focus);
      const sensitiveBioChemFocus = researchSynthesisFocus && focusLooksLikeSensitiveBioChemDesign(entry.focus);
      const creativeThroughputFlags = buildCreativeThroughputTaskFlags({
        specialtyHint,
        entry,
        targets,
        projectConfig
      });
      const planningObjective = objectiveAllowsPlanningDocumentOutcome(entry.focus);
      const creativeContinuityGuard = specialtyHint === "creative"
        ? buildCreativeContinuityGuard(project, todoState, targets)
        : [];
      const creativeFragmentContext = specialtyHint === "creative"
        ? await buildCreativeFragmentContextPromptLines(project)
        : { lines: [], blockCount: 0, fragmentCount: 0 };
      const safeDecodeProjectString = (value) => {
        try { return decodeURIComponent(String(value || "")); } catch { return String(value || ""); }
      };
      const projectName = safeDecodeProjectString(project.name);
      const projectPath = safeDecodeProjectString(project.path);
      const decodedImplementationRoot = implementationRoot && implementationRoot !== project.path
        ? safeDecodeProjectString(implementationRoot)
        : "";
      const message = [
        `Advance the project ${projectName} in ${projectPath}.`,
        "This is a focused project work package, not a full project sweep.",
        projectAssessment ? `Project assessment: ${projectAssessment.phaseLabel} phase on a ${projectAssessment.workstreamLabel} track.` : "",
        projectAssessment?.currentPriority ? `Assessment priority: ${projectAssessment.currentPriority}` : "",
        `Objective: ${entry.focus}.`,
        entry.roleName ? `Primary role for this pass: ${entry.roleName}.` : "",
        entry.roleReason ? `Why this role was selected: ${entry.roleReason}` : "",
        entry.rolePlaybook ? `Role playbook: ${entry.rolePlaybook}` : "",
        projectAssessment?.deferLatePassAudits
          ? "Defer late-pass audits such as accessibility, SEO, marketing, or compliance unless this objective explicitly requires them."
          : "",
        researchSynthesisFocus
          ? `Research pathway: treat this objective as evidence synthesis. Create or update ${projectPath}/RESEARCH-BRIEF.md with grounded findings, cited sources you actually read, confidence levels, and open questions.`
          : "",
        researchSynthesisFocus
          ? "Separate verified evidence from assumptions. If a claim is not grounded in reviewed sources, label it as unverified."
          : "",
        sensitiveBioChemFocus
          ? "Safety boundary: for bio/chemical pathway design or optimization requests, stay high-level and do not provide actionable wet-lab procedures, parameter tuning, acquisition guidance, or step-by-step synthesis instructions."
          : "",
        `Project root: ${projectPath}.`,
        targets.primaryTarget ? `Inspect first: ${projectPath}/${targets.primaryTarget}` : "",
        targets.secondaryTarget ? `Inspect second if needed: ${projectPath}/${targets.secondaryTarget}` : "",
        targets.tertiaryTarget ? `Inspect third if needed: ${projectPath}/${targets.tertiaryTarget}` : "",
        `Required planning files: ${projectPath}/PROJECT-TODO.md and ${projectPath}/PROJECT-ROLE-TASKS.md.`,
        `Expected first move: ${targets.expectedFirstMove}`,
        decodedImplementationRoot
          ? `Treat ${decodedImplementationRoot} as the canonical repository folder for implementation work. Keep project-planning docs at ${projectPath}.`
          : "",
        targets.primaryTarget === "directive.md"
          ? `For this objective, ${projectPath}/directive.md is itself a concrete project file. Completing the directive by editing that file counts as concrete implementation work.`
          : "",
        ...creativeContinuityGuard,
        ...creativeFragmentContext.lines,
        `Review ${project.path}/PROJECT-TODO.md and ${project.path}/PROJECT-ROLE-TASKS.md once, then move directly to the concrete files, directories, scripts, or TODO/FIXME targets relevant to this objective.`,
        planningObjective
          ? "For this objective, updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with the best evidenced next step counts as a concrete improvement for this pass."
          : "Make one concrete improvement for this objective now instead of only proposing a plan.",
        "If you change the project, update PROJECT-TODO.md to reflect the completed objective and add any discovered follow-up tasks.",
        "Update PROJECT-ROLE-TASKS.md by adding, checking off, or refining role-specific tasks confirmed during this focused pass.",
        `If no change is possible for this objective, inspect at least ${minConcreteTargets} distinct concrete implementation files or directories relevant to it and then say the exact phrase 'no change is possible' with the inspected paths.`,
        "Do not reply with recommendations, plans, or future tense. Describe only completed work or a verified no-change conclusion."
      ].join("\n");
      const taskCreated = await createQueuedTask({
        message,
        sessionId: "project-cycle",
        requestedBrainId: preferredWorker?.id || "worker",
        intakeBrainId: String(observerConfig?.defaults?.intakeBrainId || "intake"),
        internetEnabled: Boolean(observerConfig?.defaults?.internetEnabled),
        selectedMountIds: Array.isArray(observerConfig?.defaults?.mountIds) ? observerConfig.defaults.mountIds : [],
        forceToolUse: true,
        notes: `Queued focused project work package for ${project.name}. Objective: ${entry.focus}`.trim(),
        taskMeta: {
          internalJobType: "project_cycle",
          specialtyHint,
          ...(researchSynthesisFocus ? { researchMode: "evidence_synthesis" } : {}),
          ...(sensitiveBioChemFocus ? { safetyMode: "high_level_only" } : {}),
          ...(creativeThroughputFlags.creativeThroughputMode ? { creativeThroughputMode: creativeThroughputFlags.creativeThroughputMode } : {}),
          ...(creativeThroughputFlags.preferHigherThroughputCreativeLane ? { preferHigherThroughputCreativeLane: true } : {}),
          ...(creativeThroughputFlags.skipCreativeHandoff ? { skipCreativeHandoff: true } : {}),
          ...(creativeFragmentContext.fragmentCount ? {
            projectFragmentContextBlockCount: creativeFragmentContext.blockCount,
            projectFragmentCount: creativeFragmentContext.fragmentCount
          } : {}),
          projectName: project.name,
          projectPath: project.path,
          projectWorkKey: entry.key,
          projectWorkFocus: entry.focus,
          projectWorkSource: entry.source,
          projectWorkRoleName: entry.roleName,
          projectWorkRoleReason: entry.roleReason,
          projectWorkRolePlaybook: entry.rolePlaybook,
          projectWorkPrimaryTarget: targets.primaryTarget,
          projectWorkSecondaryTarget: targets.secondaryTarget,
          projectWorkTertiaryTarget: targets.tertiaryTarget,
          projectWorkExpectedFirstMove: targets.expectedFirstMove
        }
      });
      created.push(taskCreated);
    }
    return created;
  }

  async function processWorkspaceProjectForOpportunityScan(project, { now } = {}) {
    const backupSnapshot = await backupWorkspaceProjectSnapshot(project, { reason: "periodic" }).catch(() => null);
    const todoState = await ensureProjectTodoForWorkspaceProject(project);
    const projectTasks = await listHistoricalProjectTasks(project).catch(() => []);
    const exportRequirementsAttemptCount = projectTasks.filter((task) => String(task?.projectWorkSource || "") === "export_requirements").length;
    const exportRequirementsMode = exportRequirementsAttemptCount < 3 && shouldQueueExportRequirementsPass(todoState, projectTasks, project);
    const effectiveTodoState = exportRequirementsMode
      ? {
        ...todoState,
        exportRequirementsMode: true
      }
      : todoState;
    const PROJECT_PAUSE_FAILURE_THRESHOLD = getProjectConfig().projectPauseFailureThreshold || 20;
    const recentFailureCount = await countRecentProjectCycleFailures(project.name).catch(() => 0);
    const isProjectPaused = recentFailureCount >= PROJECT_PAUSE_FAILURE_THRESHOLD;
    const cycleTasks = (!isProjectPaused && (todoState.unchecked.length || exportRequirementsMode))
      ? await queueWorkspaceProjectCycleTasks(project, effectiveTodoState)
      : [];
    const reportEntries = [
      `Active project: ${project.name}.`,
      `Project todo: ${todoState.unchecked.length} unchecked, ${todoState.checked.length} checked.`
    ];
    if (isProjectPaused) {
      reportEntries.push(`Project paused: ${recentFailureCount} failures in the last 3 hours — manual review needed before queuing more work.`);
    }
    if (backupSnapshot?.targetPath) {
      reportEntries.push(`Saved project backup: ${backupSnapshot.targetPath}.`);
    }
    let exportedProject = null;
    const projectConfig = getProjectConfig();
    if (!todoState.unchecked.length && projectConfig.autoExportReadyProjects) {
      const hasCompletionEvidence = hasPositiveProjectCompletionEvidence(todoState, projectTasks, project);
      if (!hasCompletionEvidence) {
        reportEntries.push("Auto-export held: the project has no open todo items, but there is not enough completion evidence yet.");
        if (cycleTasks.length) {
          reportEntries.push(`Queued export requirements pass: ${cycleTasks[0].codename || cycleTasks[0].id}.`);
        }
      }
      const existingCycle = await findActiveProjectCycleTask(project.name);
      if (!existingCycle && hasCompletionEvidence) {
        exportedProject = await exportWorkspaceProjectToOutput(project, { ready: true });
        reportEntries.push(`Exported completed project: ${exportedProject.name}.`);
        if (now) {
          await appendDailyAssistantMemory(
            "Workspace Rotation",
            "Project cycle completed and was exported",
            [
              `Exported: ${exportedProject.name}.`,
              `Target: ${exportedProject.targetPath}.`
            ],
            now
          );
        }
      }
    }
    return {
      backupSnapshot,
      todoState,
      cycleTasks,
      exportedProject,
      reportEntries,
      summary: {
        projectName: project.name,
        uncheckedCount: todoState.unchecked.length,
        checkedCount: todoState.checked.length,
        queuedTasks: cycleTasks,
        backupSnapshot
      }
    };
  }

  async function planTaskMaintenanceActions(tasks) {
    if (!tasks.length) {
      return [];
    }
    const workspaceProjects = await listContainerWorkspaceProjects().catch(() => []);
    const activeWorkspaceProjectNames = new Set(
      workspaceProjects.map((entry) => String(entry?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const actions = [];
    for (const task of tasks) {
      const taskId = String(task?.id || "").trim();
      const status = String(task?.status || "").trim();
      const summary = String(task?.summary || "").toLowerCase();
      const sessionId = String(task?.sessionId || "").trim();
      const internalJobType = String(task?.internalJobType || "").trim().toLowerCase();
      const taskProjectName = String(task?.projectName || "").trim().toLowerCase();
      const isMaintenanceFollowUp = Boolean(task?.maintenanceKey || task?.parentTaskId || sessionId === "task-maintenance");
      if (!taskId) {
        continue;
      }
      if (isMaintenanceFollowUp) {
        actions.push({
          taskId,
          action: "close",
          reason: status === "failed"
            ? "This was already a maintenance follow-up task, so it should be closed instead of generating more recursive maintenance."
            : "This maintenance follow-up task is settled and can be closed."
        });
        continue;
      }
      const failureClassification = String(task?.failureClassification || classifyFailureText(String(task?.resultSummary || task?.reviewSummary || task?.workerSummary || task?.notes || ""))).trim();
      const reshapedRetryMessage = buildFailureReshapeMessage(task);
      const canReshapeAgain = canReshapeTask(task);
      if (status === "failed" && summary.includes("invalid json")) {
        actions.push({
          taskId,
          action: "close",
          reason: "The task failed because the worker returned malformed JSON, so it was closed instead of spawning more speculative retry work."
        });
        continue;
      }
      if (
        status === "failed"
        && [
          "stalled",
          "timeout",
          "no_inspection",
          "speculative_completion",
          "no_concrete_outcome",
          "no_change_insufficient_inspection",
          "no_change_missing_targets",
          "project_no_change_disallowed",
          "project_missing_concrete_change",
          "project_missing_todo_update",
          "project_documentation_only_mismatch",
          "repeated_tool_plan",
          "low_value_tool_loop",
          "invalid_envelope",
          "empty_final_response"
        ].includes(failureClassification)
      ) {
        if (canReshapeAgain) {
          actions.push({
            taskId,
            action: "follow_up",
            reason: `Maintenance reshaped this ${failureClassification || "failed"} task for another pass.`,
            followUpMessage: reshapedRetryMessage
          });
          continue;
        }
        actions.push({
          taskId,
          action: "close",
          reason: `Critical failure after ${getTaskReshapeAttemptCount(task)}/${MAX_TASK_RESHAPE_ATTEMPTS} reshaped resubmission attempts. Last classification: ${failureClassification || "unknown"}.`
        });
        continue;
      }
      if (status === "failed" && summary.includes("stalled")) {
        actions.push({
          taskId,
          action: "close",
          reason: "The task stalled and was closed after maintenance review instead of generating an automatic investigation loop."
        });
        continue;
      }
      if (
        internalJobType === "project_cycle"
        && status === "completed"
        && taskProjectName
        && activeWorkspaceProjectNames.has(taskProjectName)
      ) {
        continue;
      }
      actions.push({
        taskId,
        action: "close",
        reason: status === "failed"
          ? "The task has already been reviewed and no better automatic follow-up is clear."
          : "The task is settled and can be closed after maintenance review."
      });
    }
    return actions;
  }

  return {
    buildProjectWorkPackages,
    chooseProjectWorkTargets,
    exportWorkspaceProjectToOutput,
    fillWorkspaceProjectsFromRepositories,
    getProjectWorkAttemptCooldownMs,
    countFailedProjectWorkAttempts,
    findRecentProjectCycleMessageAttempt,
    findRecentProjectWorkAttempt,
    findTaskByProjectWorkKey,
    listClosedTasksForProjectAttemptAccounting,
    planTaskMaintenanceActions,
    processWorkspaceProjectForOpportunityScan,
    queueWorkspaceProjectCycleTasks,
    rotateWorkspaceProjectFromRepositories
  };
}
