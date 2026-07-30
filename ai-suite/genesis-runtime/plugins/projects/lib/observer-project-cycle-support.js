export function createObserverProjectCycleSupport(context = {}) {
  const {
    canBrainHandleSpecialty,
    classifyFailureText,
    compactTaskText,
    extractTaskDirectiveValue,
    hashRef,
    isProjectCycleTask,
    listAllTasks,
    listAvailableBrains,
    normalizeContainerMountPathCandidate,
    path,
    removeTaskDirectiveValue,
    replaceTaskDirectiveValue
  } = context;

  function buildProjectPipelineSnapshot(task = {}) {
    const summary = String(task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim();
    return {
      id: String(task.id || "").trim(),
      codename: String(task.codename || "").trim(),
      status: String(task.status || "").trim(),
      requestedBrainId: String(task.requestedBrainId || "").trim(),
      requestedBrainLabel: String(task.requestedBrainLabel || task.requestedBrainId || "").trim(),
      previousTaskId: String(task.previousTaskId || "").trim(),
      failureClassification: String(task.failureClassification || classifyFailureText(summary)).trim(),
      projectWorkRoleName: String(task.projectWorkRoleName || "").trim(),
      projectWorkRoleReason: compactTaskText(String(task.projectWorkRoleReason || "").trim(), 180),
      capabilityMismatchSuspected: task.capabilityMismatchSuspected === true,
      createdAt: Number(task.createdAt || 0),
      startedAt: Number(task.startedAt || 0),
      completedAt: Number(task.completedAt || task.updatedAt || 0),
      updatedAt: Number(task.updatedAt || task.completedAt || task.createdAt || 0),
      summary: compactTaskText(summary, 220)
    };
  }

  function summarizeProjectPipeline(tasks = []) {
    const sorted = [...tasks]
      .filter((task) => task && typeof task === "object")
      .sort((left, right) => Number(left.createdAt || left.updatedAt || 0) - Number(right.createdAt || right.updatedAt || 0));
    if (!sorted.length) {
      return null;
    }
    const stages = sorted.map((task) => buildProjectPipelineSnapshot(task));
    const latest = stages.reduce((best, current) => (
      Number(current.updatedAt || current.createdAt || 0) >= Number(best.updatedAt || best.createdAt || 0) ? current : best
    ), stages[0]);
    return {
      projectWorkKey: String(sorted[0].projectWorkKey || "").trim(),
      projectName: String(sorted[0].projectName || "").trim(),
      focus: compactTaskText(String(sorted[0].projectWorkFocus || sorted[0].message || "").trim(), 220),
      projectWorkRoleName: String(latest.projectWorkRoleName || sorted[0].projectWorkRoleName || "").trim(),
      projectWorkRoleReason: compactTaskText(String(latest.projectWorkRoleReason || sorted[0].projectWorkRoleReason || "").trim(), 180),
      latestTaskId: latest.id,
      latestCodename: latest.codename,
      latestRequestedBrainId: latest.requestedBrainId,
      latestRequestedBrainLabel: latest.requestedBrainLabel,
      finalStatus: latest.status,
      finalFailureClassification: latest.failureClassification,
      attemptCount: stages.length,
      handoffCount: stages.filter((stage) => stage.previousTaskId).length,
      completedAttemptCount: stages.filter((stage) => stage.status === "completed").length,
      failedAttemptCount: stages.filter((stage) => stage.status === "failed").length,
      capabilityMismatchCount: stages.filter((stage) => stage.capabilityMismatchSuspected).length,
      startedAt: Number(sorted[0].createdAt || sorted[0].updatedAt || 0),
      updatedAt: Number(latest.updatedAt || latest.createdAt || 0),
      stages
    };
  }

  function buildProjectPipelineCollection(tasks = []) {
    const groups = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (!isProjectCycleTask(task)) {
        continue;
      }
      const key = String(task.projectWorkKey || task.id || "").trim();
      if (!key) {
        continue;
      }
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(task);
    }
    return [...groups.values()]
      .map((group) => summarizeProjectPipeline(group))
      .filter(Boolean)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }

  async function listProjectPipelines({ limit = 24 } = {}) {
    const { queued, waiting, inProgress, done, failed } = await listAllTasks();
    return buildProjectPipelineCollection([...queued, ...waiting, ...inProgress, ...done, ...failed])
      .slice(0, Math.max(1, Math.min(Number(limit || 24), 200)));
  }

  async function getProjectPipelineTrace({ projectWorkKey = "", taskId = "" } = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedKey = String(projectWorkKey || "").trim();
    const { queued, waiting, inProgress, done, failed } = await listAllTasks();
    const allTasks = [...queued, ...waiting, ...inProgress, ...done, ...failed];
    const matchedTask = normalizedTaskId
      ? allTasks.find((task) => String(task.id || "").trim() === normalizedTaskId)
      : null;
    const pipelineKey = normalizedKey || String(matchedTask?.projectWorkKey || "").trim();
    if (!pipelineKey) {
      return null;
    }
    const group = allTasks.filter((task) => String(task.projectWorkKey || "").trim() === pipelineKey);
    return summarizeProjectPipeline(group);
  }

  async function chooseProjectCycleRecoveryBrain(task = {}, failureClassification = "", specialty = "general", attemptedBrainIds = []) {
    if (!isProjectCycleTask(task)) {
      return null;
    }
    const normalizedFailure = String(failureClassification || "").trim().toLowerCase();
    if (!["invalid_json", "empty_final_response", "invalid_envelope", "repeated_tool_plan", "low_value_tool_loop", "hidden_tool_not_available", "project_final_missing_changed_target", "project_completion_policy_blocked"].includes(normalizedFailure)) {
      return null;
    }
    const attempted = new Set((Array.isArray(attemptedBrainIds) ? attemptedBrainIds : [attemptedBrainIds])
      .map((value) => String(value || "").trim())
      .filter(Boolean));
    if (attempted.has("worker")) {
      return null;
    }
    const availableBrains = await listAvailableBrains();
    const workerBrain = availableBrains.find((brain) =>
      String(brain?.id || "").trim() === "worker"
      && brain.kind === "worker"
      && brain.toolCapable
      && canBrainHandleSpecialty(brain, specialty || "general")
    );
    return workerBrain || null;
  }

  function buildConcreteReviewReason({
    task = {},
    sourceTask = null,
    attemptedBrains = [],
    classification = "",
    fallback = ""
  } = {}) {
    const anchorTask = sourceTask && typeof sourceTask === "object" ? sourceTask : task;
    const failure = String(classification || anchorTask?.failureClassification || classifyFailureText(anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "")).trim() || "unknown";
    const brains = [...new Set((Array.isArray(attemptedBrains) ? attemptedBrains : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
    const brainChain = brains.length ? brains.join(" -> ") : String(anchorTask?.requestedBrainLabel || anchorTask?.requestedBrainId || "").trim();
    const outcome = compactTaskText(
      String(anchorTask?.resultSummary || anchorTask?.reviewSummary || anchorTask?.workerSummary || anchorTask?.notes || "").trim(),
      240
    );
    const genericFallback = String(fallback || "").trim();
    if (outcome || brainChain || failure !== "unknown") {
      return compactTaskText(
        [
          `Reviewed ${anchorTask?.codename || anchorTask?.id || "the source task"}.`,
          brainChain ? `Worker chain: ${brainChain}.` : "",
          failure !== "unknown" ? `Failure class: ${failure}.` : "",
          outcome ? `Recorded outcome: ${outcome}` : ""
        ].filter(Boolean).join(" "),
        320
      );
    }
    return compactTaskText(genericFallback, 320);
  }

  function buildProjectCycleFollowUpMessage(task = {}, { focusOverride = "", retryNote = "" } = {}) {
    const baseMessage = String(task?.message || "").trim();
    if (!baseMessage) {
      return compactTaskText(String(retryNote || focusOverride || "").trim(), 600);
    }
    let nextMessage = baseMessage;
    const normalizedFocus = compactTaskText(String(focusOverride || "").trim(), 220);
    if (normalizedFocus) {
      nextMessage = replaceTaskDirectiveValue(nextMessage, "Objective:", `${normalizedFocus}.`);
      nextMessage = removeTaskDirectiveValue(nextMessage, "Inspect first:");
      const projectRoot = normalizeContainerMountPathCandidate(
        extractTaskDirectiveValue(nextMessage, "Project root:").replace(/[)."'\`,;:!?]+$/g, "").trim()
      );
      if (projectRoot) {
        nextMessage = replaceTaskDirectiveValue(
          nextMessage,
          "Expected first move:",
          `List ${projectRoot} and inspect the most relevant concrete implementation file or directory for the updated objective before deciding on further edits.`
        );
      } else {
        nextMessage = removeTaskDirectiveValue(nextMessage, "Expected first move:");
      }
    }
    const normalizedRetryNote = compactTaskText(String(retryNote || "").trim(), 320);
    if (normalizedRetryNote) {
      nextMessage = `${nextMessage}\n\nEscalation note: ${normalizedRetryNote}`;
    }
    return nextMessage.trim();
  }

  function buildEscalationSplitProjectWorkKey(task = {}, focusOverride = "") {
    const baseKey = String(task?.projectWorkKey || "").trim();
    const focus = compactTaskText(String(focusOverride || "").trim(), 220);
    if (!baseKey || !focus) {
      return baseKey;
    }
    return `${baseKey}:split:${hashRef(focus.toLowerCase())}`;
  }

  function chooseEscalationRetryBrainId({ requestedBrainId = "", availableWorkers = [], attemptedBrains = [] } = {}) {
    const normalizedRequested = String(requestedBrainId || "").trim();
    const normalizedAvailable = (Array.isArray(availableWorkers) ? availableWorkers : []).map((value) => String(value || "").trim()).filter(Boolean);
    const attempted = new Set((Array.isArray(attemptedBrains) ? attemptedBrains : [attemptedBrains]).map((value) => String(value || "").trim()).filter(Boolean));
    if (normalizedRequested && normalizedAvailable.includes(normalizedRequested) && !attempted.has(normalizedRequested)) {
      return normalizedRequested;
    }
    return normalizedAvailable.find((brainId) => !attempted.has(brainId)) || "";
  }

  function objectiveIsAlreadySingleTarget(objective = "", primaryTarget = "", inspectSecond = "", inspectThird = "") {
    const normalizedObjective = String(objective || "").trim().toLowerCase();
    const normalizedPrimaryTarget = String(primaryTarget || "").trim();
    const extraTargets = [inspectSecond, inspectThird].map((value) => String(value || "").trim()).filter(Boolean);
    if (!normalizedObjective || !normalizedPrimaryTarget) {
      return false;
    }
    if (extraTargets.length > 1) {
      return false;
    }
    const fileLikeTarget = /\.[a-z0-9]{1,8}$/i.test(normalizedPrimaryTarget) || /\/[^/\s]+\.[a-z0-9]{1,8}$/i.test(normalizedPrimaryTarget);
    const namesPrimaryTarget = normalizedObjective.includes(path.basename(normalizedPrimaryTarget).toLowerCase());
    const singleArtifactVerb = /^(create|write|rewrite|update|fix|improve|document|summari[sz]e|tighten|strengthen)\b/.test(normalizedObjective);
    return fileLikeTarget && (namesPrimaryTarget || singleArtifactVerb);
  }

  function buildEscalationCloseRecommendation(task = {}, sourceTask = {}, reason = "") {
    const failureClassification = String(task?.failureClassification || sourceTask?.failureClassification || "").trim().toLowerCase();
    const summary = compactTaskText(String(reason || "").trim(), 220) || "Escalation planner reviewed the failed worker chain.";
    const harnessSnapshot = task?.harnessEvalSnapshot && typeof task.harnessEvalSnapshot === "object"
      ? task.harnessEvalSnapshot
      : sourceTask?.harnessEvalSnapshot && typeof sourceTask.harnessEvalSnapshot === "object"
        ? sourceTask.harnessEvalSnapshot
        : null;
    const harnessSignals = Array.isArray(harnessSnapshot?.signals)
      ? harnessSnapshot.signals.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const harnessTools = harnessSnapshot?.tools && typeof harnessSnapshot.tools === "object"
      ? harnessSnapshot.tools
      : {};
    const harnessHealth = harnessSnapshot?.health && typeof harnessSnapshot.health === "object"
      ? harnessSnapshot.health
      : {};
    const harnessHealthStatus = String(harnessHealth.status || "").trim();
    const harnessHealthReasons = Array.isArray(harnessHealth.reasons)
      ? harnessHealth.reasons.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const fallbackPrimaryTarget = String(task?.projectPath || "").trim() && String(task?.projectWorkPrimaryTarget || "").trim()
      ? `${String(task.projectPath || "").trim()}/${String(task.projectWorkPrimaryTarget || "").trim()}`
      : "";
    const inspectFirst = extractTaskDirectiveValue(String(task?.message || "").trim(), "Inspect first:")
      || fallbackPrimaryTarget;
    const inspectSecond = extractTaskDirectiveValue(String(task?.message || "").trim(), "Inspect second if needed:");
    const inspectThird = extractTaskDirectiveValue(String(task?.message || "").trim(), "Inspect third if needed:");
    const objective = extractTaskDirectiveValue(String(task?.message || "").trim(), "Objective:")
      || String(task?.projectWorkFocus || "").trim();
    const primaryTarget = compactTaskText(inspectFirst || inspectSecond || String(task?.projectWorkPrimaryTarget || "").trim(), 240);
    const alreadySingleTarget = objectiveIsAlreadySingleTarget(objective, primaryTarget, inspectSecond, inspectThird);
    let recommendation = "Recommended next step: narrow the work to one concrete target and retry with a more specific brief.";
    if (failureClassification === "repeated_tool_plan" && primaryTarget) {
      recommendation = `Recommended next step: narrow the pass to ${primaryTarget} and continue from that concrete target instead of replaying the startup bundle.`;
    } else if (failureClassification === "low_value_tool_loop" && primaryTarget) {
      recommendation = `Recommended next step: retry from ${primaryTarget} and require the next pass to converge to one edit, artifact, capability request, or valid no-change conclusion instead of more inspection-only steps.`;
    } else if (failureClassification === "hidden_tool_not_available" && primaryTarget) {
      recommendation = `Recommended next step: retry from ${primaryTarget} with only the currently exposed tools, and request or search for any missing capability instead of calling hidden tools directly.`;
    } else if (failureClassification === "tool_fetch_failed" && primaryTarget) {
      recommendation = `Recommended next step: retry a narrower pass starting with ${primaryTarget} so the next worker can stay on one concrete target instead of a broader fetch-heavy path.`;
    } else if (failureClassification === "invalid_json" && primaryTarget) {
      recommendation = `Recommended next step: retry on a single concrete target starting with ${primaryTarget} and keep the brief minimal so the next worker does not fail at the envelope stage.`;
    } else if (failureClassification === "no_inspection" && primaryTarget) {
      recommendation = `Recommended next step: force the next pass to inspect ${primaryTarget} before any conclusion so the worker cannot stop without concrete evidence.`;
    } else if (failureClassification === "project_final_missing_changed_target" && primaryTarget) {
      recommendation = `Recommended next step: retry from ${primaryTarget} and require final_text to name the changed project file or directory before completion.`;
    } else if (failureClassification === "project_completion_policy_blocked" && primaryTarget) {
      recommendation = `Recommended next step: retry from ${primaryTarget}, resolve the recorded completion-policy blocker, and finish only with changed files, validation outcome, or valid no-change evidence.`;
    } else if (alreadySingleTarget && primaryTarget) {
      recommendation = `Recommended next step: this already appears to be a single-target task focused on ${primaryTarget}, so do not split it smaller. Retry with a sharper brief that names exactly which facts to extract, which files to inspect first, and what artifact shape is required.`;
    } else if (objective) {
      recommendation = `Recommended next step: restate the objective as one smaller concrete pass focused on ${primaryTarget || "the named first target"} and retry from there.`;
    }
    const harnessNotes = [];
    if (harnessSignals.includes("inspection_heavy")) {
      harnessNotes.push("Harness signal: the failed pass was inspection-heavy, so the retry should avoid another broad read/list sweep.");
    }
    if (harnessSignals.includes("hidden_tool_violation") || Number(harnessTools.hiddenToolViolationCount || 0) > 0) {
      harnessNotes.push("Harness signal: the failed pass attempted a hidden tool, so the retry must stay inside the focused tool list or request the missing capability.");
    }
    if (Number(harnessTools.readOnlyOkCount || 0) > 0 && Number(harnessTools.actionOkCount || 0) === 0) {
      harnessNotes.push(`Harness signal: previous read/action balance was ${Number(harnessTools.readOnlyOkCount || 0)}/0, so the retry needs an action, capability request, or valid no-change conclusion.`);
    }
    if (harnessHealthReasons.includes("tool_selection_uncertain") || harnessTools.toolSelectionConfident === false) {
      const selectorReason = String(harnessTools.toolSelectionReason || "").trim();
      const matchedFamilies = Array.isArray(harnessTools.matchedToolFamilies)
        ? harnessTools.matchedToolFamilies.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      harnessNotes.push(`Harness signal: tool selection was uncertain${selectorReason ? ` (${selectorReason})` : ""}${matchedFamilies.length ? ` after matching ${matchedFamilies.join(", ")}` : ""}.`);
    }
    if (harnessHealthStatus === "needs_attention" && harnessHealthReasons.length) {
      harnessNotes.push(`Harness health: needs_attention (${harnessHealthReasons.join(", ")}).`);
    }
    return [summary, recommendation, ...harnessNotes].filter(Boolean).join(" ").trim();
  }

  return {
    buildConcreteReviewReason,
    buildEscalationCloseRecommendation,
    buildEscalationSplitProjectWorkKey,
    buildProjectCycleFollowUpMessage,
    buildProjectPipelineCollection,
    chooseEscalationRetryBrainId,
    chooseProjectCycleRecoveryBrain,
    getProjectPipelineTrace,
    listProjectPipelines
  };
}
