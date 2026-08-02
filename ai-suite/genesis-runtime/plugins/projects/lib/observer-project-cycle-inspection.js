export function createObserverProjectCycleInspection(context = {}) {
  const {
    classifyFailureText,
    compactTaskText,
    extractContainerPathCandidates,
    normalizeContainerMountPathCandidate,
    normalizeTaskDirectivePath,
    path
  } = context;

  function buildFailureInvestigationTaskMessage(task, followUpMessage = "") {
    const cleanFollowUp = compactTaskText(String(followUpMessage || "").replace(/\s+/g, " ").trim(), 220);
    if (cleanFollowUp && !/^worker returned an invalid json/i.test(cleanFollowUp)) {
      return cleanFollowUp;
    }
    const taskId = String(task?.id || "").trim();
    const summary = compactTaskText(
      String(task?.reviewSummary || task?.resultSummary || task?.workerSummary || task?.notes || "").replace(/\s+/g, " ").trim(),
      220
    );
    const classification = classifyFailureText(summary);
    return compactTaskText(
      `Investigate ${classification} failure for ${task?.codename || taskId || "task"} and determine whether prompt, routing, or tool handling should change. Source task: ${taskId || "unknown"}.`,
      220
    );
  }

  function extractTaskDirectiveValue(message = "", label = "") {
    const prefix = String(label || "").trim().toLowerCase();
    if (!prefix) {
      return "";
    }
    for (const rawLine of String(message || "").split(/\r?\n/)) {
      const line = String(rawLine || "").trim();
      if (line.toLowerCase().startsWith(prefix)) {
        return line.slice(prefix.length).trim();
      }
    }
    return "";
  }

  function objectiveRequiresConcreteImprovement(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    return /^(make|create|add|implement|fix|update|improve|tighten|strengthen|expand|refactor|rewrite|repair|build|complete|finish|check|tick|mark)\b/.test(text)
      || /\bconcrete improvement\b/.test(text)
      || /\badvance the project meaningfully\b/.test(text);
  }

  function objectiveAllowsDocumentationOnlyChange(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    return /\b(readme|docs?|documentation|guide|handoff|summary|status|brief|spec(?:ification)?|directive\.md|project-todo\.md|project-role-tasks\.md|todo file|role task(?:s| board)?|task board|copy)\b/.test(text)
      || /\breview the project structure\b/.test(text)
      || /\bidentify the best [a-z0-9 /-]*next step\b/.test(text)
      || /\bidentify the best next step\b/.test(text)
      || /\bclarify the most shippable next step\b/.test(text)
      || /\brecord the next concrete step\b/.test(text)
      || /\brequired for export\b/.test(text)
      || /\bexport blocker\b/.test(text)
      || /\bcompletion evidence\b/.test(text);
  }

  function objectiveRequiresNonDocumentationArtifact(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text || objectiveAllowsDocumentationOnlyChange(text)) {
      return false;
    }
    return /^(implement|build|fix|repair|refactor|rewrite|verify|ensure|add|update|improve|complete|finish)\b/.test(text)
      || /\b(code|script|app|api|endpoint|route|renderer|render|three\.js|mixamo|keyframe|interpolation|asset|console error|loading|server|client|component|ui|validation|flask|react|vue|svelte|node|python|test|coverage|package|dependency|animation|logic|handler|html|css|javascript|typescript)\b/.test(text);
  }

  function objectiveAllowsValidationOnlyOutcome(objective = "") {
    const text = String(objective || "").trim().toLowerCase();
    if (!text) {
      return false;
    }
    if (/\b(?:check|tick|mark)\s+(?:this\s+)?(?:box|checkbox)\b/.test(text) || /\bunchecked directive item\b/.test(text)) {
      return false;
    }
    return /^(verify|validate|test|run|build|compile|lint|audit|check)\b/.test(text)
      || /\b(?:run|pass|passes|passing|builds?|tests?|validation|verified|validated|smoke test|runnable)\b/.test(text);
  }

  function replaceTaskDirectiveValue(message = "", label = "", nextValue = "") {
    const normalizedLabel = String(label || "").trim();
    const normalizedValue = String(nextValue || "").trim();
    const lines = String(message || "").split(/\r?\n/);
    let replaced = false;
    const nextLines = lines.map((line) => {
      if (String(line || "").trim().toLowerCase().startsWith(normalizedLabel.toLowerCase())) {
        replaced = true;
        return normalizedValue ? `${normalizedLabel} ${normalizedValue}` : String(line || "");
      }
      return String(line || "");
    });
    if (!replaced && normalizedValue) {
      nextLines.push(`${normalizedLabel} ${normalizedValue}`);
    }
    return nextLines.join("\n").trim();
  }

  function removeTaskDirectiveValue(message = "", label = "") {
    const normalizedLabel = String(label || "").trim().toLowerCase();
    if (!normalizedLabel) {
      return String(message || "").trim();
    }
    return String(message || "")
      .split(/\r?\n/)
      .filter((line) => !String(line || "").trim().toLowerCase().startsWith(normalizedLabel))
      .join("\n")
      .trim();
  }

  function normalizeContainerPathForComparison(value = "") {
    return String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function extractProjectCycleProjectRoot(message = "") {
    const explicitRoot = normalizeTaskDirectivePath(extractTaskDirectiveValue(message, "Project root:"));
    if (explicitRoot.startsWith("/home/nova/")) {
      return explicitRoot;
    }
    const impliedMatch = String(message || "").match(/Advance\s+the\s+project\s+.+?\s+in\s+(\S+)/i);
    const impliedRoot = normalizeTaskDirectivePath(String(impliedMatch?.[1] || ""));
    if (impliedRoot.startsWith("/home/nova/")) {
      return impliedRoot;
    }
    return "";
  }

  function extractProjectCycleImplementationRoots(message = "") {
    const roots = new Set();
    const projectRoot = extractProjectCycleProjectRoot(message);
    const normalizedProjectRoot = normalizeContainerPathForComparison(projectRoot);
    if (normalizedProjectRoot.startsWith("/home/nova/")) {
      roots.add(normalizedProjectRoot);
    }
    const canonicalMatch = String(message || "").match(/Treat\s+(\S+)\s+as the canonical repository folder for implementation work\./i);
    const canonicalRoot = normalizeContainerPathForComparison(
      normalizeContainerMountPathCandidate(String(canonicalMatch?.[1] || "").replace(/[)."'\`,;:!?]+$/g, "").trim())
    );
    if (canonicalRoot.startsWith("/home/nova/")) {
      roots.add(canonicalRoot);
    }
    return [...roots];
  }

  function isPlanningDocumentPath(value = "") {
    const normalized = normalizeContainerPathForComparison(value).toLowerCase();
    return /\/project-todo\.md$/.test(normalized) || /\/project-role-tasks\.md$/.test(normalized);
  }

  function isDocumentationProjectFile(value = "") {
    const normalized = normalizeContainerPathForComparison(value).toLowerCase();
    if (!normalized) {
      return false;
    }
    const basename = normalized.split("/").pop() || normalized;
    return /(^|\/)docs?\//.test(normalized)
      || /\.(md|mdx|txt|rst)$/i.test(basename)
      || /^readme\.md$/.test(basename)
      || /^directive\.md$/.test(basename)
      || /^project-(todo|role-tasks)\.md$/.test(basename)
      || /(^|\/)(summary|status|handoff|notes?)\.md$/.test(normalized);
  }

  function isConcreteImplementationInspectionTarget(target = "", { projectRoots = [] } = {}) {
    const normalizedTarget = String(target || "").trim();
    if (!normalizedTarget) {
      return false;
    }
    const candidatePaths = normalizedTarget.startsWith("/home/nova/")
      ? [normalizedTarget]
      : extractContainerPathCandidates(normalizedTarget);
    const normalizedRoots = (Array.isArray(projectRoots) ? projectRoots : [projectRoots])
      .map((value) => normalizeContainerPathForComparison(value))
      .filter(Boolean);
    for (const candidate of candidatePaths) {
      const normalizedCandidate = normalizeContainerPathForComparison(candidate);
      if (!normalizedCandidate || isPlanningDocumentPath(normalizedCandidate)) {
        continue;
      }
      if (normalizedRoots.some((root) => normalizedCandidate === root)) {
        continue;
      }
      if (normalizedRoots.length && !normalizedRoots.some((root) => normalizedCandidate.startsWith(`${root}/`))) {
        continue;
      }
      return true;
    }
    return false;
  }

  function buildProjectCycleCompletionPolicy(message = "", { minimumConcreteTargets = 3 } = {}) {
    const normalizedMessage = String(message || "").trim();
    const projectRootPath = extractProjectCycleProjectRoot(normalizedMessage);
    const projectRoots = extractProjectCycleImplementationRoots(normalizedMessage);
    const inspectFirstTarget = extractTaskDirectiveValue(normalizedMessage, "Inspect first:");
    const expectedFirstMove = extractTaskDirectiveValue(normalizedMessage, "Expected first move:");
    const objectiveText = extractTaskDirectiveValue(normalizedMessage, "Objective:");
    const requiresConcreteImprovement = objectiveRequiresConcreteImprovement(objectiveText);
    const allowsDocumentationOnlyChange = objectiveAllowsDocumentationOnlyChange(objectiveText);
    const requiresNonDocumentationArtifact = objectiveRequiresNonDocumentationArtifact(objectiveText);
    const allowsValidationOnlyOutcome = objectiveAllowsValidationOnlyOutcome(objectiveText);
    const normalizedProjectRoots = projectRoots
      .map((candidate) => normalizeContainerPathForComparison(candidate))
      .filter(Boolean);
    const projectTodoPath = projectRootPath
      ? normalizeContainerPathForComparison(`${projectRootPath}/PROJECT-TODO.md`)
      : "";
    return {
      isProjectCycleTask: /\/project-todo\.md\b/i.test(normalizedMessage)
        || /\bthis is a focused project work package\b/i.test(normalizedMessage),
      message: normalizedMessage,
      objectiveText,
      requiresConcreteImprovement,
      objectiveAllowsDocumentationOnlyChange: allowsDocumentationOnlyChange,
      requiresNonDocumentationArtifact,
      allowsValidationOnlyOutcome,
      minimumConcreteTargets: Math.max(1, Number(minimumConcreteTargets || 3)),
      projectRootPath,
      projectRoots,
      normalizedProjectRoots,
      projectTodoPath,
      inspectFirstTarget,
      expectedFirstMove,
      noChangeAllowed: !requiresConcreteImprovement,
      requiresProjectTodoUpdate: requiresConcreteImprovement,
      requiresConcreteProjectChange: requiresConcreteImprovement
    };
  }

  function evaluateProjectCycleCompletionState({
    policy = null,
    message = "",
    finalText = "",
    inspectedTargets = [],
    changedWorkspaceFiles = [],
    changedOutputFiles = [],
    successfulToolNames = []
  } = {}) {
    const effectivePolicy = policy && typeof policy === "object"
      ? policy
      : buildProjectCycleCompletionPolicy(message);
    const normalizedSuccessfulToolNames = (Array.isArray(successfulToolNames) ? successfulToolNames : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean);
    const normalizedInspectedTargets = [...new Set((Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .map((target) => normalizeContainerPathForComparison(target))
      .filter(Boolean))];
    const normalizedChangedWorkspaceFiles = (Array.isArray(changedWorkspaceFiles) ? changedWorkspaceFiles : [])
      .map((file) => ({
        ...file,
        normalizedPath: normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || "")
      }))
      .filter((file) => file.normalizedPath);
    const normalizedChangedOutputFiles = (Array.isArray(changedOutputFiles) ? changedOutputFiles : [])
      .map((file) => ({
        ...file,
        normalizedPath: normalizeContainerPathForComparison(file?.containerPath || file?.fullPath || file?.path || "")
      }))
      .filter((file) => file.normalizedPath);
    const normalizedFinalText = String(finalText || "").trim();
    const usedInspectionTool = normalizedSuccessfulToolNames
      .some((name) => ["list_files", "read_document", "read_file", "shell_command", "web_fetch"].includes(name));
    const usedValidationTool = normalizedSuccessfulToolNames
      .some((name) => ["shell_command", "web_fetch"].includes(name));
    const usedWriteTool = normalizedSuccessfulToolNames
      .some((name) => ["write_file", "edit_file", "move_path"].includes(name));
    const hasConcreteFileChange = normalizedChangedOutputFiles.length > 0 || normalizedChangedWorkspaceFiles.length > 0;
    const hasConcreteImplementationInspection = effectivePolicy.isProjectCycleTask
      ? normalizedInspectedTargets.some((target) => {
        if (effectivePolicy.objectiveAllowsDocumentationOnlyChange && isPlanningDocumentPath(target)) {
          return true;
        }
        return isConcreteImplementationInspectionTarget(target, { projectRoots: effectivePolicy.projectRoots });
      })
      : usedInspectionTool;
    const changedConcreteProjectFiles = normalizedChangedWorkspaceFiles.filter((file) =>
      effectivePolicy.normalizedProjectRoots.some((root) => {
        if (!(file.normalizedPath === root || file.normalizedPath.startsWith(`${root}/`))) {
          return false;
        }
        const lower = file.normalizedPath.toLowerCase();
        if (effectivePolicy.objectiveAllowsDocumentationOnlyChange) {
          return true;
        }
        return !lower.endsWith("/project-todo.md") && !lower.endsWith("/project-role-tasks.md");
      })
    );
    const changedImplementationProjectFiles = changedConcreteProjectFiles.filter((file) =>
      !isDocumentationProjectFile(file.normalizedPath)
    );
    const changedProjectTodo = effectivePolicy.projectTodoPath
      ? normalizedChangedWorkspaceFiles.some((file) => file.normalizedPath === effectivePolicy.projectTodoPath)
      : false;
    const hasNoChangeConclusion = /\b(ready for export|no further advance|no further advances|no change is possible|no changes are possible|no safe change is needed|no safe changes are needed|no change is needed|no changes are needed|no edit is needed|no edits are needed|no actionable change(?:s)? (?:was|were|is|are)?\s*(?:found|needed))\b/i.test(normalizedFinalText);
    const normalizedFinalTextLower = normalizedFinalText.toLowerCase();
    const mentionedInspectedTargets = normalizedInspectedTargets.filter((target) => {
      const normalizedTarget = String(target || "").trim().toLowerCase();
      if (!normalizedTarget) {
        return false;
      }
      const basename = normalizedTarget.split("/").pop() || "";
      return normalizedFinalTextLower.includes(normalizedTarget)
        || (basename.length >= 4 && normalizedFinalTextLower.includes(basename));
    });
    const mentionedChangedConcreteProjectFiles = changedConcreteProjectFiles.filter((file) => {
      const normalizedPath = String(file?.normalizedPath || "").trim().toLowerCase();
      if (!normalizedPath) {
        return false;
      }
      const basename = normalizedPath.split("/").pop() || "";
      return normalizedFinalTextLower.includes(normalizedPath)
        || (basename.length >= 4 && normalizedFinalTextLower.includes(basename));
    });
    const namedInspectedTargetCount = mentionedInspectedTargets.length;
    const namedChangedConcreteProjectFileCount = mentionedChangedConcreteProjectFiles.length;
    const namesInspectedTargets = normalizedInspectedTargets.length >= effectivePolicy.minimumConcreteTargets
      && namedInspectedTargetCount >= effectivePolicy.minimumConcreteTargets;
    const soundsSpeculative = /\b(i will|i'll|next step|plan to|would be to|highest-value improvement)\b/i.test(normalizedFinalText)
      || /\(example\)\s*:/i.test(normalizedFinalText)
      || /\bi noticed\b/i.test(normalizedFinalText)
      || /\bfollowing\b.{0,60}\bimprovement\b/i.test(normalizedFinalText)
      || /\bthis means that\b/i.test(normalizedFinalText)
      || /\bi will edit\b/i.test(normalizedFinalText);
    const finalReportsValidationAttempt = /\b(?:ran|run completed|verified|validated|tested|checked|built|compiled|linted|audited)\b/i.test(normalizedFinalText);
    const finalReportsValidationOutcome = /\b(?:passed|passes|passing|succeeded|successfully|failed|failure|error|errors|exit code|status|built|compiled|linted|green|clean)\b/i.test(normalizedFinalText);
    const finalReportsValidation = finalReportsValidationAttempt && finalReportsValidationOutcome;
    const hasMachineVerifiableValidation = effectivePolicy.allowsValidationOnlyOutcome === true
      && usedValidationTool
      && finalReportsValidation
      && !soundsSpeculative;
    const inspectedExpectedFirstTarget = didInspectNamedTarget(normalizedInspectedTargets, effectivePolicy.inspectFirstTarget);
    const blockingCodes = [];
    if (soundsSpeculative) {
      blockingCodes.push("speculative_final_text");
    }
    if (!usedInspectionTool && !hasConcreteFileChange) {
      blockingCodes.push("missing_grounded_inspection");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.inspectFirstTarget && usedInspectionTool && !inspectedExpectedFirstTarget && !hasConcreteImplementationInspection) {
      blockingCodes.push("skipped_named_first_target");
    }
    if (effectivePolicy.isProjectCycleTask && !hasConcreteImplementationInspection) {
      blockingCodes.push("missing_concrete_implementation_inspection");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && normalizedInspectedTargets.length < effectivePolicy.minimumConcreteTargets) {
      blockingCodes.push("no_change_insufficient_targets");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && !namesInspectedTargets) {
      blockingCodes.push("no_change_missing_named_targets");
    }
    if (effectivePolicy.isProjectCycleTask && hasNoChangeConclusion && effectivePolicy.requiresConcreteImprovement) {
      blockingCodes.push("no_change_disallowed_for_objective");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.requiresConcreteProjectChange && !hasNoChangeConclusion && !changedConcreteProjectFiles.length) {
      blockingCodes.push("missing_concrete_project_change");
    }
    if (
      effectivePolicy.isProjectCycleTask
      && effectivePolicy.requiresConcreteProjectChange
      && !hasNoChangeConclusion
      && changedConcreteProjectFiles.length
      && namedChangedConcreteProjectFileCount === 0
    ) {
      blockingCodes.push("final_missing_changed_project_target");
    }
    if (
      effectivePolicy.isProjectCycleTask
      && effectivePolicy.requiresNonDocumentationArtifact
      && !hasNoChangeConclusion
      && changedConcreteProjectFiles.length
      && !changedImplementationProjectFiles.length
    ) {
      blockingCodes.push("documentation_only_objective_mismatch");
    }
    if (effectivePolicy.isProjectCycleTask && effectivePolicy.requiresProjectTodoUpdate && !hasNoChangeConclusion && effectivePolicy.projectTodoPath && !changedProjectTodo) {
      blockingCodes.push("missing_project_todo_update");
    }
    if (!usedWriteTool && !normalizedChangedOutputFiles.length && !normalizedChangedWorkspaceFiles.length && !hasNoChangeConclusion && !hasMachineVerifiableValidation) {
      blockingCodes.push("missing_machine_verifiable_outcome");
    }
    return {
      policy: effectivePolicy,
      usedInspectionTool,
      usedValidationTool,
      usedWriteTool,
      hasConcreteFileChange,
      hasMachineVerifiableValidation,
      hasConcreteImplementationInspection,
      changedConcreteProjectFiles: changedConcreteProjectFiles.map((file) => ({
        fullPath: String(file?.fullPath || "").trim(),
        containerPath: String(file?.containerPath || "").trim()
      })),
      changedImplementationProjectFiles: changedImplementationProjectFiles.map((file) => ({
        fullPath: String(file?.fullPath || "").trim(),
        containerPath: String(file?.containerPath || "").trim()
      })),
      changedProjectTodo,
      hasNoChangeConclusion,
      namedInspectedTargetCount,
      namedChangedConcreteProjectFileCount,
      namesInspectedTargets,
      soundsSpeculative,
      inspectedExpectedFirstTarget,
      objectiveAllowsDocumentationOnlyChange: effectivePolicy.objectiveAllowsDocumentationOnlyChange,
      requiresNonDocumentationArtifact: effectivePolicy.requiresNonDocumentationArtifact,
      allowsValidationOnlyOutcome: effectivePolicy.allowsValidationOnlyOutcome,
      blockingCodes,
      eligibleForCompletion: blockingCodes.length === 0
    };
  }

  function didInspectNamedTarget(inspectedTargets = [], expectedTarget = "") {
    const normalizedExpected = normalizeContainerPathForComparison(expectedTarget).toLowerCase();
    if (!normalizedExpected) {
      return false;
    }
    return (Array.isArray(inspectedTargets) ? inspectedTargets : [])
      .some((target) => normalizeContainerPathForComparison(target).toLowerCase() === normalizedExpected);
  }

  return {
    buildFailureInvestigationTaskMessage,
    didInspectNamedTarget,
    extractProjectCycleImplementationRoots,
    extractProjectCycleProjectRoot,
    extractTaskDirectiveValue,
    buildProjectCycleCompletionPolicy,
    evaluateProjectCycleCompletionState,
    isConcreteImplementationInspectionTarget,
    isDocumentationProjectFile,
    isPlanningDocumentPath,
    normalizeContainerPathForComparison,
    objectiveAllowsDocumentationOnlyChange,
    objectiveAllowsValidationOnlyOutcome,
    objectiveRequiresConcreteImprovement,
    objectiveRequiresNonDocumentationArtifact,
    removeTaskDirectiveValue,
    replaceTaskDirectiveValue
  };
}
