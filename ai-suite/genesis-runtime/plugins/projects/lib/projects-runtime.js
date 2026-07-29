import { escapeRegex } from "../../../observer-general-utils.js";
import { createObserverProjectCycleInspection } from "./observer-project-cycle-inspection.js";
import { createObserverProjectCycleSupport } from "./observer-project-cycle-support.js";
import { createObserverProjectPlanning } from "./observer-project-planning.js";
import { createObserverProjectState } from "./observer-project-state.js";
import { createObserverProjectWorkspaceSupport } from "./observer-project-workspace-support.js";
import { createProjectFragmentSystem } from "./project-fragment-system.js";
import { PROJECT_ROLE_PLAYBOOKS as DEFAULT_PROJECT_ROLE_PLAYBOOKS } from "./project-role-playbooks.js";
import { normalizeProjectsConfigForBootstrap } from "../../../observer-core-state.js";

export function createProjectsRuntime(context = {}) {
  const {
    MAX_TASK_RESHAPE_ATTEMPTS,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    OBSERVER_INPUT_HOST_ROOT,
    OBSERVER_OUTPUT_ROOT,
    PROJECT_ARCHIVE_OUTPUT_ROOT,
    PROJECT_BACKUP_OUTPUT_ROOT,
    PROJECT_MARKER_FILE_NAME = ".observer-project.json",
    PROJECT_READY_OUTPUT_ROOT,
    PROJECT_ROLE_PLAYBOOKS: configuredProjectRolePlaybooks,
    TASK_QUEUE_CLOSED,
    appendDailyAssistantMemory,
    buildFailureReshapeMessage,
    canBrainHandleSpecialty,
    canReshapeTask,
    chooseIdleWorkerBrainForSpecialty,
    classifyFailureText,
    compactTaskText,
    createQueuedTask,
    extractContainerPathCandidates,
    findActiveProjectCycleTask,
    formatDateTimeForUser,
    fs,
    getObserverConfig,
    getTaskReshapeAttemptCount,
    hashRef,
    importRepositoryProjectToWorkspace,
    inferTaskCapabilityProfile,
    inferTaskSpecialty,
    inspectWorkspaceProject,
    listAllTasks,
    listAvailableBrains,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    moveContainerPath,
    moveWorkspaceProjectToOutput,
    normalizeContainerMountPathCandidate,
    normalizeSummaryComparisonText,
    normalizeTaskDirectivePath,
    opportunityScanState,
    path,
    readContainerFile,
    readJsonFileIfExists,
    readTextFileIfExists,
    snapshotWorkspaceProjectToOutput,
    summarizeTaskCapabilities,
    syncWorkspaceProjectToRepositorySource,
    writeContainerTextFile
  } = context;
  const projectRolePlaybooks = Array.isArray(configuredProjectRolePlaybooks) && configuredProjectRolePlaybooks.length
    ? configuredProjectRolePlaybooks
    : DEFAULT_PROJECT_ROLE_PLAYBOOKS;

  function resolveProjectArtifactRoot(explicitRoot = "", childName = "") {
    const normalizedExplicitRoot = String(explicitRoot || "").trim();
    if (normalizedExplicitRoot) {
      return normalizedExplicitRoot;
    }
    const normalizedOutputRoot = String(OBSERVER_OUTPUT_ROOT || "").trim();
    if (!normalizedOutputRoot || !childName) {
      return normalizedOutputRoot;
    }
    return path.join(normalizedOutputRoot, childName);
  }

  function normalizeProjectConfigInput(configured = {}) {
    return normalizeProjectsConfigForBootstrap(configured);
  }

  function getProjectConfig() {
    return normalizeProjectConfigInput(getObserverConfig?.()?.projects && typeof getObserverConfig()?.projects === "object"
      ? getObserverConfig().projects
      : {});
  }

  function getProjectNoChangeMinimumTargets() {
    return getProjectConfig().noChangeMinimumConcreteTargets;
  }

  async function removeProjectChecklistItem({ filePath = "", itemText = "" } = {}) {
    const normalizedPath = String(filePath || "").trim();
    const normalizedText = String(itemText || "").trim().toLowerCase();
    if (!normalizedPath || !normalizedText) {
      throw new Error("filePath and itemText are required");
    }
    const content = await readTextFileIfExists(normalizedPath);
    const lines = content.split(/\r?\n/);
    const filtered = lines.filter((line) => {
      const match = line.match(/^\s*(?:[-*]\s+)?\[([^\]]*)\]\s+(.+?)\s*$/);
      if (!match) {
        return true;
      }
      return String(match[2] || "").trim().toLowerCase() !== normalizedText;
    });
    if (filtered.length === lines.length) {
      throw new Error(`Checklist item not found: ${itemText}`);
    }
    await fs.writeFile(normalizedPath, filtered.join("\n"), "utf8");
  }

  async function addProjectRole({ roleTaskPath = "", roleName = "", reason = "" } = {}) {
    const normalizedPath = String(roleTaskPath || "").trim();
    const normalizedName = String(roleName || "").trim();
    if (!normalizedPath || !normalizedName) {
      throw new Error("roleTaskPath and roleName are required");
    }
    let content = await readTextFileIfExists(normalizedPath);
    const lineToAdd = `- ${normalizedName}${reason ? `: ${reason}` : ""}`;
    const activeSectionMatch = content.match(/^## Active Roles\s*$/m);
    if (activeSectionMatch) {
      const already = content.match(new RegExp(`^\\s*[-*]\\s+${escapeRegex(normalizedName)}`, "m"));
      if (already) {
        return;
      }
      content = content.replace(/^(## Active Roles\s*)$/m, `$1\n${lineToAdd}`);
    } else {
      content = content.trimEnd() + `\n\n## Active Roles\n${lineToAdd}\n`;
    }
    await fs.writeFile(normalizedPath, content, "utf8");
  }

  async function removeProjectRole({ roleTaskPath = "", roleName = "" } = {}) {
    const normalizedPath = String(roleTaskPath || "").trim();
    const normalizedName = String(roleName || "").trim().toLowerCase();
    if (!normalizedPath || !normalizedName) {
      throw new Error("roleTaskPath and roleName are required");
    }
    const content = await readTextFileIfExists(normalizedPath);
    const lines = content.split(/\r?\n/);
    let inActiveRoles = false;
    const filtered = lines.filter((line) => {
      const heading = line.match(/^\s*##\s+(.+?)\s*$/);
      if (heading) {
        inActiveRoles = String(heading[1] || "").trim() === "Active Roles";
        return true;
      }
      if (!inActiveRoles) {
        return true;
      }
      const roleMatch = line.match(/^\s*[-*]\s+([^:]+?)(?::\s*(.+))?\s*$/);
      if (!roleMatch) {
        return true;
      }
      return String(roleMatch[1] || "").trim().toLowerCase() !== normalizedName;
    });
    await fs.writeFile(normalizedPath, filtered.join("\n"), "utf8");
  }

  function isProjectCycleTask(task = {}) {
    return (
      String(task?.sessionId || "").trim() === "project-cycle"
      || String(task?.internalJobType || "").trim() === "project_cycle"
    );
  }

  function isProjectCycleMessage(message = "") {
    const text = String(message || "").trim().toLowerCase();
    return (
      /^advance the project\b/.test(text)
      || /\bthis is a focused project work package\b/.test(text)
    );
  }

  function buildProjectQueuedTaskExecutionPrompt({ taskPrompt = "", task = {}, capabilitySummary = "" } = {}) {
    const basePrompt = String(taskPrompt || "").trim();
    if (!basePrompt) {
      return "";
    }
    const capabilityNote = capabilitySummary
      ? ` Predicted capability focus: ${capabilitySummary}.`
      : "";
    const expectedFirstMove = cycleInspection.extractTaskDirectiveValue(basePrompt, "Expected first move:");
    const firstMoveNote = expectedFirstMove
      ? " Honor the named first move before falling back to generic planning-file rereads or broad repo listings."
      : "";
    return `${basePrompt}\n\nThis work item came from the shared task queue.${capabilityNote} Keep project changes inside the workspace while the project is still in progress. Do not write project deliverables to ${OBSERVER_CONTAINER_OUTPUT_ROOT} unless the whole project is complete and ready for export.${firstMoveNote} After the initial inspection, prefer edit_file for targeted project changes, write_file for new or fully rewritten project files, and move_path for renames instead of repeating read-only tool passes once the concrete edit is clear. Summarize the concrete workspace changes clearly.`;
  }

  const cycleInspection = createObserverProjectCycleInspection({
    classifyFailureText,
    compactTaskText,
    extractContainerPathCandidates,
    normalizeContainerMountPathCandidate,
    normalizeTaskDirectivePath,
    path
  });
  const planning = createObserverProjectPlanning({
    PROJECT_ROLE_PLAYBOOKS: projectRolePlaybooks,
    compactTaskText,
    getProjectConfig,
    inspectWorkspaceProject,
    moveContainerPath,
    normalizeSummaryComparisonText,
    path,
    readContainerFile,
    writeContainerTextFile
  });
  const cycleSupport = createObserverProjectCycleSupport({
    canBrainHandleSpecialty,
    classifyFailureText,
    compactTaskText,
    extractTaskDirectiveValue: cycleInspection.extractTaskDirectiveValue,
    hashRef,
    isProjectCycleTask,
    listAllTasks,
    listAvailableBrains,
    normalizeContainerMountPathCandidate,
    path,
    removeTaskDirectiveValue: cycleInspection.removeTaskDirectiveValue,
    replaceTaskDirectiveValue: cycleInspection.replaceTaskDirectiveValue
  });
  const fragmentSystem = createProjectFragmentSystem({
    compactTaskText,
    fs,
    listContainerWorkspaceProjects,
    path
  });
  const workspaceSupport = createObserverProjectWorkspaceSupport({
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
    buildProjectFragmentContext: fragmentSystem.buildProjectFragmentContext,
    buildProjectAssessment: planning.buildProjectAssessment,
    ensureProjectTodoForWorkspaceProject: planning.ensureProjectTodoForWorkspaceProject,
    findActiveProjectCycleTask,
    formatDateTimeForUser,
    fs,
    getObserverConfig,
    getProjectConfig,
    getProjectImplementationRoot: planning.getProjectImplementationRoot,
    getTaskReshapeAttemptCount,
    hashRef,
    importRepositoryProjectToWorkspace,
    inferProjectCycleSpecialty: planning.inferProjectCycleSpecialty,
    inferTaskSpecialty,
    listAllTasks,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    moveWorkspaceProjectToOutput,
    normalizeSummaryComparisonText,
    opportunityScanState,
    path,
    pickInspectionFile: planning.pickInspectionFile,
    snapshotWorkspaceProjectToOutput,
    syncWorkspaceProjectToRepositorySource,
    writeContainerTextFile
  });
  const projectState = createObserverProjectState({
    OBSERVER_INPUT_HOST_ROOT,
    PROJECT_ARCHIVE_OUTPUT_ROOT: resolveProjectArtifactRoot(PROJECT_ARCHIVE_OUTPUT_ROOT, "workspace-archive"),
    PROJECT_BACKUP_OUTPUT_ROOT: resolveProjectArtifactRoot(PROJECT_BACKUP_OUTPUT_ROOT, "project-backups"),
    PROJECT_MARKER_FILE_NAME,
    PROJECT_READY_OUTPUT_ROOT: resolveProjectArtifactRoot(PROJECT_READY_OUTPUT_ROOT, "projects-ready"),
    PROJECT_ROLE_PLAYBOOKS: projectRolePlaybooks,
    TASK_QUEUE_CLOSED,
    buildProjectPipelineCollection: cycleSupport.buildProjectPipelineCollection,
    classifyFailureText,
    compactTaskText,
    ensureProjectTodoForWorkspaceProject: planning.ensureProjectTodoForWorkspaceProject,
    buildProjectFragmentSummary: fragmentSystem.buildProjectFragmentSummary,
    fs,
    getProjectConfig,
    listAllTasks,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    opportunityScanState,
    parseProjectRoleTaskBoardState: planning.parseProjectRoleTaskBoardState,
    path,
    readContainerFile,
    readJsonFileIfExists,
    readTextFileIfExists
  });

  return {
    ...cycleInspection,
    ...cycleSupport,
    ...planning,
    ...projectState,
    ...fragmentSystem,
    ...workspaceSupport,
    addProjectRole,
    buildProjectQueuedTaskExecutionPrompt,
    getProjectConfig,
    getProjectNoChangeMinimumTargets,
    getProjectRolePlaybooks: () => projectRolePlaybooks.slice(),
    isProjectCycleMessage,
    isProjectCycleTask,
    normalizeProjectConfigInput,
    removeProjectChecklistItem,
    removeProjectRole
  };
}
