import { compactText } from "../../../observer-general-utils.js";

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(
    toArray(values)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  )];
}

function requireRuntimeFn(runtime = {}, name = "") {
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

function pickTaskTimestamp(task = {}) {
  return Number(
    task.completedAt
    || task.updatedAt
    || task.startedAt
    || task.createdAt
    || Date.now()
  ) || Date.now();
}

function inferTaskLabel(task = {}) {
  return String(
    task.projectName
    || task.projectTitle
    || task.taskLabel
    || task.codename
    || task.id
    || "task"
  ).trim() || "task";
}

function buildBlankRun(taskId = "") {
  return {
    taskId,
    codename: "",
    label: "",
    status: "unknown",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: 0,
    projectName: "",
    projectTitle: "",
    sessionId: "",
    summary: "",
    planes: {
      orch: {
        executed: [],
        workflow: [],
        scheduler: [],
        tools: [],
        evidence: []
      },
      gov: {
        policyDecisions: [],
        approvals: [],
        gates: [],
        evidence: []
      },
      mem: {
        contextSources: [],
        continuity: [],
        evidence: []
      },
      mirror: {
        validations: [],
        auditTrail: [],
        evidence: []
      }
    },
    metrics: {
      governedSignals: 0,
      improvisedSignals: 0,
      unknownSignals: 0,
      governedPct: null,
      label: "unknown"
    },
    inspect: {
      executedWhat: "",
      policyAllowedIt: "",
      memoryShapedIt: "",
      approvalGates: "",
      validatedBeforeAction: "",
      inspectAfterward: "",
      governedVsImprovised: ""
    }
  };
}

function trimRunArrays(run = {}, limits = {}) {
  const maxEvidencePerPlane = Math.max(8, Number(limits.maxEvidencePerPlane || 18) || 18);
  const maxPolicyDecisions = Math.max(6, Number(limits.maxPolicyDecisions || 10) || 10);
  const maxApprovals = Math.max(4, Number(limits.maxApprovals || 8) || 8);
  const maxGates = Math.max(4, Number(limits.maxGates || 8) || 8);
  const maxValidations = Math.max(4, Number(limits.maxValidations || 10) || 10);
  run.planes.orch.executed = uniqueStrings(run.planes.orch.executed).slice(0, 12);
  run.planes.orch.workflow = uniqueStrings(run.planes.orch.workflow).slice(0, 12);
  run.planes.orch.scheduler = uniqueStrings(run.planes.orch.scheduler).slice(0, 8);
  run.planes.orch.tools = uniqueStrings(run.planes.orch.tools).slice(0, 12);
  run.planes.orch.evidence = toArray(run.planes.orch.evidence).slice(0, maxEvidencePerPlane);
  run.planes.gov.policyDecisions = toArray(run.planes.gov.policyDecisions).slice(0, maxPolicyDecisions);
  run.planes.gov.approvals = toArray(run.planes.gov.approvals).slice(0, maxApprovals);
  run.planes.gov.gates = uniqueStrings(run.planes.gov.gates).slice(0, maxGates);
  run.planes.gov.evidence = toArray(run.planes.gov.evidence).slice(0, maxEvidencePerPlane);
  run.planes.mem.contextSources = uniqueStrings(run.planes.mem.contextSources).slice(0, 12);
  run.planes.mem.continuity = uniqueStrings(run.planes.mem.continuity).slice(0, 8);
  run.planes.mem.evidence = toArray(run.planes.mem.evidence).slice(0, maxEvidencePerPlane);
  run.planes.mirror.validations = uniqueStrings(run.planes.mirror.validations).slice(0, maxValidations);
  run.planes.mirror.auditTrail = uniqueStrings(run.planes.mirror.auditTrail).slice(0, 12);
  run.planes.mirror.evidence = toArray(run.planes.mirror.evidence).slice(0, maxEvidencePerPlane);
}

function recomputeMetrics(run = {}) {
  const governedSignals = [
    run.planes.orch.workflow.length > 0,
    run.planes.orch.tools.length > 0,
    run.planes.gov.policyDecisions.length > 0,
    run.planes.gov.approvals.length > 0,
    run.planes.gov.gates.length > 0,
    run.planes.mem.contextSources.length > 0,
    run.planes.mem.continuity.length > 0,
    run.planes.mirror.validations.length > 0,
    run.planes.mirror.auditTrail.length > 0
  ].filter(Boolean).length;

  const improvisedSignals = [
    run.status === "failed",
    run.status === "unknown",
    run.planes.gov.policyDecisions.length === 0,
    run.planes.mirror.validations.length === 0,
    run.planes.mem.contextSources.length === 0,
    run.planes.orch.tools.length === 0
  ].filter(Boolean).length;

  const unknownSignals = [
    !run.summary,
    !run.codename,
    !run.sessionId
  ].filter(Boolean).length;

  const observedTotal = governedSignals + improvisedSignals;
  const governedPct = observedTotal > 0
    ? Math.round((governedSignals / observedTotal) * 100)
    : null;

  let label = "unknown";
  if (governedPct != null) {
    if (governedPct >= 70) {
      label = "governed";
    } else if (governedPct >= 40) {
      label = "mixed";
    } else {
      label = "improvised";
    }
  }

  run.metrics = {
    governedSignals,
    improvisedSignals,
    unknownSignals,
    governedPct,
    label
  };

  run.inspect = {
    executedWhat: run.planes.orch.executed.length
      ? run.planes.orch.executed.join(" | ")
      : "Execution evidence is still thin.",
    policyAllowedIt: run.planes.gov.policyDecisions.length
      ? run.planes.gov.policyDecisions.map((entry) => `${entry.behavior}: ${entry.reason}`).join(" | ")
      : "No explicit policy decision has been recorded for this run.",
    memoryShapedIt: run.planes.mem.contextSources.length
      ? run.planes.mem.contextSources.join(" | ")
      : "No runtime memory or continuity source has been captured yet.",
    approvalGates: run.planes.gov.approvals.length || run.planes.gov.gates.length
      ? [...run.planes.gov.gates, ...run.planes.gov.approvals.map((entry) => `${entry.status}: ${entry.reason}`)].join(" | ")
      : "No approval gate has been observed.",
    validatedBeforeAction: run.planes.mirror.validations.length
      ? run.planes.mirror.validations.join(" | ")
      : "No validation or reflection step is visible yet.",
    inspectAfterward: run.planes.mirror.auditTrail.length
      ? run.planes.mirror.auditTrail.join(" | ")
      : "Audit trail is minimal so far.",
    governedVsImprovised: governedPct == null
      ? "Insufficient evidence to score governed versus improvised behavior."
      : `${governedPct}% governed from observable signals (${governedSignals} governed / ${improvisedSignals} improvised / ${unknownSignals} unknown).`
  };
}

function summarizeToolNames(task = {}) {
  const names = [];
  const toolLoopSummary = compactText(String(task?.toolLoopDiagnostics?.summary || "").trim(), 180);
  if (toolLoopSummary) {
    names.push(toolLoopSummary);
  }
  const recentToolNames = toArray(task?.toolLoopDiagnostics?.tools)
    .map((entry) => compactText(entry?.name || entry?.toolName || entry, 120))
    .filter(Boolean);
  names.push(...recentToolNames);
  return uniqueStrings(names);
}

function summarizeApproval(payload = {}) {
  const approvalDecision = payload?.approvalDecision && typeof payload.approvalDecision === "object"
    ? payload.approvalDecision
    : {};
  const permissionApproval = payload?.permissionDecision?.approval && typeof payload.permissionDecision.approval === "object"
    ? payload.permissionDecision.approval
    : {};
  const status = String(approvalDecision.value || permissionApproval.status || "required").trim() || "required";
  return {
    status,
    key: String(approvalDecision.key || permissionApproval.key || "").trim(),
    reason: compactText(
      String(
        permissionApproval.reason
        || payload?.decisionReason
        || payload?.permissionDecision?.reason
        || "approval gate"
      ).trim(),
      180
    )
  };
}

export function createGovernanceRuntime(options = {}) {
  const {
    api,
    pluginId = "governance",
    stateDataKey = "governance-state",
    maxRuns = 180,
    maxRecentRequests = 120
  } = options;

  const runtimeContext = api.getRuntimeContext?.() || {};
  const listAllTasks = requireRuntimeFn(runtimeContext, "listAllTasks");
  const findTaskById = requireRuntimeFn(runtimeContext, "findTaskById");
  const state = {
    version: 1,
    updatedAt: 0,
    runs: [],
    recentRequests: []
  };
  let persistTimer = null;
  let hydratedOnce = false;

  const ready = (async () => {
    if (!api.data) {
      return;
    }
    const stored = await api.data.readJson(stateDataKey, {});
    state.version = Number(stored?.version || 1) || 1;
    state.updatedAt = Number(stored?.updatedAt || 0) || 0;
    state.runs = toArray(stored?.runs)
      .filter((entry) => entry && typeof entry === "object" && String(entry.taskId || "").trim())
      .slice(0, maxRuns)
      .map((entry) => ({
        ...buildBlankRun(String(entry.taskId || "").trim()),
        ...entry,
        planes: {
          ...buildBlankRun(String(entry.taskId || "").trim()).planes,
          ...(entry.planes && typeof entry.planes === "object" ? entry.planes : {})
        }
      }));
    state.recentRequests = toArray(stored?.recentRequests).slice(0, maxRecentRequests);
    for (const run of state.runs) {
      trimRunArrays(run);
      recomputeMetrics(run);
    }
  })();

  function schedulePersist() {
    if (!api.data) {
      return;
    }
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void persistNow().catch((error) => {
        console.warn("[governance] failed to persist governance state:", error?.message || error);
      });
    }, 250);
  }

  async function persistNow() {
    if (!api.data) {
      return;
    }
    await ready;
    await api.data.writeJson(stateDataKey, {
      version: 1,
      updatedAt: Date.now(),
      runs: state.runs.slice(0, maxRuns),
      recentRequests: state.recentRequests.slice(0, maxRecentRequests)
    });
  }

  function sortRuns() {
    state.runs.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    state.runs = state.runs.slice(0, maxRuns);
  }

  function getRun(taskId = "", seed = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    let run = state.runs.find((entry) => entry.taskId === normalizedTaskId) || null;
    if (!run) {
      run = {
        ...buildBlankRun(normalizedTaskId),
        ...seed
      };
      state.runs.unshift(run);
    }
    run.updatedAt = Date.now();
    if (!run.createdAt) {
      run.createdAt = Date.now();
    }
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    return run;
  }

  function noteRecentRequest(payload = {}) {
    state.recentRequests.unshift({
      requestId: String(payload.requestId || "").trim(),
      method: String(payload.method || "").trim(),
      path: compactText(String(payload.path || "").trim(), 180),
      taskId: String(payload.taskId || payload?.response?.taskId || payload?.body?.taskId || "").trim(),
      subsystems: toArray(payload.subsystems).map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 8),
      statusCode: Number(payload.statusCode || 0) || 0,
      durationMs: Number(payload.durationMs || 0) || 0,
      at: Number(payload.at || Date.now()) || Date.now()
    });
    state.recentRequests = state.recentRequests.slice(0, maxRecentRequests);
  }

  function mergeTaskIntoRun(task = {}) {
    const taskId = String(task.id || "").trim();
    if (!taskId) {
      return null;
    }
    const run = getRun(taskId, {
      createdAt: pickTaskTimestamp(task)
    });
    run.codename = String(task.codename || run.codename || taskId).trim();
    run.label = inferTaskLabel(task);
    run.status = String(task.status || run.status || "unknown").trim().toLowerCase() || "unknown";
    run.projectName = String(task.projectName || run.projectName || "").trim();
    run.projectTitle = String(task.projectTitle || run.projectTitle || "").trim();
    run.sessionId = String(task.sessionId || run.sessionId || "").trim();
    run.summary = compactText(
      String(
        task.reviewSummary
        || task.resultSummary
        || task.workerSummary
        || task.notes
        || task.message
        || run.summary
        || ""
      ).trim(),
      260
    );
    run.createdAt = Math.min(Number(run.createdAt || Date.now()), pickTaskTimestamp(task));
    run.completedAt = Number(task.completedAt || run.completedAt || 0) || 0;

    run.planes.orch.executed.push(
      compactText(String(task.message || task.description || inferTaskLabel(task)).trim(), 180)
    );
    run.planes.orch.workflow.push(
      ...uniqueStrings([
        String(task.internalJobType || "").trim(),
        String(task.requestedBrainId || "").trim(),
        String(task.requestedBrainLabel || "").trim(),
        task.scheduler?.periodic ? "periodic scheduler" : "",
        task.internetEnabled === true ? "internet enabled" : "internet disabled"
      ])
    );
    if (task.scheduler?.name) {
      run.planes.orch.scheduler.push(compactText(String(task.scheduler.name || "").trim(), 120));
    }
    run.planes.orch.tools.push(...summarizeToolNames(task));
    run.planes.orch.evidence.unshift({
      at: pickTaskTimestamp(task),
      source: "task",
      status: run.status,
      summary: compactText(String(task.message || task.notes || run.summary || "").trim(), 180)
    });

    run.planes.gov.gates.push(
      task.status === "waiting_for_user" || task.questionForUser ? "user approval gate observed" : "",
      task.permissionApprovalRequired === true ? "permission approval required" : ""
    );
    run.planes.gov.evidence.unshift({
      at: pickTaskTimestamp(task),
      source: "task",
      summary: compactText(String(task.questionForUser || task.permissionReason || "").trim(), 180)
    });

    run.planes.mem.contextSources.push(
      task.sessionId ? `session ${compactText(task.sessionId, 48)}` : "",
      task.projectName ? `project ${compactText(task.projectName, 72)}` : "",
      Array.isArray(task.selectedMountIds) && task.selectedMountIds.length
        ? `mounts ${task.selectedMountIds.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 4).join(", ")}`
        : "",
      task.internetEnabled === true ? "external web context available" : "web context restricted"
    );
    run.planes.mem.continuity.push(
      task.previousTaskId ? `continued from ${compactText(task.previousTaskId, 48)}` : "",
      task.escalationParentTaskId ? `escalated from ${compactText(task.escalationParentTaskId, 48)}` : ""
    );
    run.planes.mem.evidence.unshift({
      at: pickTaskTimestamp(task),
      source: "task",
      summary: compactText(
        String(
          task.sessionId
          || task.projectName
          || task.projectTitle
          || task.previousTaskId
          || ""
        ).trim(),
        180
      )
    });

    run.planes.mirror.validations.push(
      compactText(String(task.reviewSummary || "").trim(), 180),
      compactText(String(task.resultSummary || "").trim(), 180),
      compactText(String(task.toolLoopDiagnostics?.summary || "").trim(), 180),
      Number(task.reshapeAttemptCount || 0) > 0 ? `reshape attempts: ${Number(task.reshapeAttemptCount || 0)}` : "",
      task.failureClassification ? `failure classification: ${compactText(task.failureClassification, 120)}` : ""
    );
    const outputFiles = toArray(task.outputFiles)
      .map((entry) => compactText(entry?.path || entry?.name || "", 120))
      .filter(Boolean);
    if (outputFiles.length) {
      run.planes.mirror.auditTrail.push(`outputs: ${outputFiles.join(", ")}`);
    }
    run.planes.mirror.auditTrail.push(`status: ${run.status}`);
    run.planes.mirror.evidence.unshift({
      at: pickTaskTimestamp(task),
      source: "task",
      summary: compactText(
        String(task.reviewSummary || task.resultSummary || task.toolLoopDiagnostics?.summary || run.status).trim(),
        180
      )
    });

    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
    return run;
  }

  async function hydrateFromTasks() {
    await ready;
    if (!listAllTasks) {
      return;
    }
    const allTasks = await listAllTasks();
    for (const bucketName of ["queued", "inProgress", "done", "failed"]) {
      for (const task of toArray(allTasks?.[bucketName])) {
        mergeTaskIntoRun(task);
      }
    }
    hydratedOnce = true;
  }

  async function ensureRunForTask(taskId = "") {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return null;
    }
    await ready;
    let run = state.runs.find((entry) => entry.taskId === normalizedTaskId) || null;
    if (run) {
      return run;
    }
    if (findTaskById) {
      const task = await findTaskById(normalizedTaskId);
      if (task) {
        return mergeTaskIntoRun(task);
      }
    }
    return getRun(normalizedTaskId);
  }

  async function ingestPermissionDecision(payload = {}) {
    await ready;
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) {
      return;
    }
    const run = await ensureRunForTask(taskId);
    if (!run) {
      return;
    }
    run.planes.gov.policyDecisions.unshift({
      at: Number(payload.at || Date.now()) || Date.now(),
      toolName: String(payload.toolName || "").trim(),
      behavior: String(payload.behavior || "allow").trim(),
      reason: compactText(String(payload.decisionReason || "").trim(), 180)
    });
    const approval = summarizeApproval(payload);
    if (approval.reason || approval.key || approval.status !== "required") {
      run.planes.gov.approvals.unshift(approval);
    }
    run.planes.gov.evidence.unshift({
      at: Number(payload.at || Date.now()) || Date.now(),
      source: "permissions",
      summary: compactText(
        `${String(payload.toolName || "").trim()} ${String(payload.behavior || "").trim()} ${String(payload.decisionReason || "").trim()}`,
        180
      )
    });
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
  }

  async function ingestObserverEvent(payload = {}) {
    await ready;
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) {
      return;
    }
    const run = await ensureRunForTask(taskId);
    if (!run) {
      return;
    }
    const eventType = String(payload.type || "").trim();
    const eventSummary = compactText(
      `${eventType || "event"} ${String(payload.taskStatus || "").trim()}`.trim(),
      140
    );
    run.status = String(payload.taskStatus || run.status || "unknown").trim().toLowerCase() || run.status;
    run.planes.orch.evidence.unshift({
      at: Number(payload.ts || Date.now()) || Date.now(),
      source: "observer:event",
      summary: eventSummary
    });
    run.planes.mirror.auditTrail.push(eventSummary);
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
  }

  async function ingestHttpEvent(payload = {}) {
    await ready;
    noteRecentRequest(payload);
    const taskId = String(payload.taskId || payload?.response?.taskId || payload?.body?.taskId || "").trim();
    if (!taskId) {
      schedulePersist();
      return;
    }
    const run = await ensureRunForTask(taskId);
    if (!run) {
      schedulePersist();
      return;
    }
    run.planes.mirror.auditTrail.push(
      compactText(
        `${String(payload.method || "GET").trim()} ${String(payload.path || "").trim()} ${Number(payload.statusCode || 0) || ""}`.trim(),
        160
      )
    );
    run.planes.mirror.evidence.unshift({
      at: Number(payload.at || Date.now()) || Date.now(),
      source: "http",
      summary: compactText(String(payload.path || "").trim(), 160)
    });
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
  }

  async function ingestWorkerExecution(payload = {}) {
    await ready;
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) {
      return;
    }
    const run = await ensureRunForTask(taskId);
    if (!run) {
      return;
    }
    const eventType = payload.ok === true
      ? "worker execution completed"
      : payload.error
        ? "worker execution failed"
        : "worker execution started";
    if (payload.brain?.label || payload.brain?.id) {
      run.planes.orch.workflow.push(
        compactText(
          `${String(payload.brain?.label || payload.brain?.id || "").trim()} ${String(payload.preset || "").trim()}`.trim(),
          120
        )
      );
    }
    if (Array.isArray(payload.toolsUsed) && payload.toolsUsed.length) {
      run.planes.orch.tools.push(...payload.toolsUsed.map((entry) => compactText(entry, 80)));
    }
    run.planes.orch.evidence.unshift({
      at: Number(payload.at || Date.now()) || Date.now(),
      source: "worker:execution",
      summary: compactText(
        `${eventType}${payload.durationMs ? ` (${Number(payload.durationMs)}ms)` : ""}`,
        160
      )
    });
    if (payload.ok === true) {
      run.planes.mirror.validations.push(
        compactText(String(payload.finalText || "").trim(), 180),
        Array.isArray(payload.outputFiles) && payload.outputFiles.length
          ? `artifacts: ${payload.outputFiles.slice(0, 4).join(", ")}`
          : ""
      );
    } else if (payload.error) {
      run.planes.mirror.auditTrail.push(`execution failure: ${compactText(String(payload.error || "").trim(), 160)}`);
    }
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
  }

  async function ingestWorkerToolCall(payload = {}) {
    await ready;
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) {
      return;
    }
    const run = await ensureRunForTask(taskId);
    if (!run) {
      return;
    }
    const toolName = compactText(String(payload.name || "").trim(), 80);
    if (toolName) {
      run.planes.orch.tools.push(toolName);
    }
    const toolSummary = compactText(
      `${toolName || "tool"} ${payload.semanticOk === true ? "ok" : payload.permissionApprovalRequired === true ? "approval-gated" : payload.transportOk === false ? "failed" : "started"}`,
      140
    );
    run.planes.orch.evidence.unshift({
      at: Number(payload.at || Date.now()) || Date.now(),
      source: "worker:tool-call",
      summary: toolSummary
    });
    if (payload.permissionApprovalRequired === true) {
      run.planes.gov.gates.push("tool execution paused for approval");
      run.planes.gov.approvals.unshift({
        status: "required",
        key: "",
        reason: compactText(String(payload.error || `${toolName} requires approval`).trim(), 180)
      });
    }
    if (payload.semanticOk === true) {
      run.planes.mirror.auditTrail.push(toolSummary);
    } else if (payload.error) {
      run.planes.mirror.auditTrail.push(`${toolName}: ${compactText(String(payload.error || "").trim(), 140)}`);
    }
    trimRunArrays(run);
    recomputeMetrics(run);
    sortRuns();
    schedulePersist();
  }

  function buildPolicySurface() {
    const observerConfig = typeof api.getObserverConfig === "function"
      ? (api.getObserverConfig() || {})
      : {};
    const defaults = observerConfig?.defaults && typeof observerConfig.defaults === "object"
      ? observerConfig.defaults
      : {};
    const mounts = Array.isArray(observerConfig?.mounts) ? observerConfig.mounts : [];
    return {
      internetEnabled: defaults.internetEnabled !== false,
      defaultMountCount: Array.isArray(defaults.mountIds) ? defaults.mountIds.length : 0,
      queuePaused: observerConfig?.queue?.paused === true,
      mountRoots: mounts
        .map((entry) => compactText(String(entry?.containerPath || entry?.hostPath || "").trim(), 120))
        .filter(Boolean)
        .slice(0, 8)
    };
  }

  async function getRunSnapshot(taskId = "") {
    const run = await ensureRunForTask(taskId);
    if (!run) {
      return null;
    }
    return JSON.parse(JSON.stringify(run));
  }

  async function listRunSnapshots(limitInput = 24) {
    await ready;
    if (!hydratedOnce) {
      await hydrateFromTasks();
    }
    const limit = Math.max(1, Math.min(Number(limitInput || 24) || 24, 80));
    return state.runs.slice(0, limit).map((run) => JSON.parse(JSON.stringify(run)));
  }

  async function buildSummary(limitInput = 24) {
    await ready;
    if (!hydratedOnce) {
      await hydrateFromTasks();
    }
    const runs = await listRunSnapshots(limitInput);
    const summary = {
      pluginId,
      generatedAt: Date.now(),
      runCount: runs.length,
      policySurface: buildPolicySurface(),
      governedCount: runs.filter((entry) => entry?.metrics?.label === "governed").length,
      mixedCount: runs.filter((entry) => entry?.metrics?.label === "mixed").length,
      improvisedCount: runs.filter((entry) => entry?.metrics?.label === "improvised").length,
      planeCoverage: {
        orch: runs.filter((entry) => entry?.planes?.orch?.workflow?.length).length,
        gov: runs.filter((entry) => entry?.planes?.gov?.policyDecisions?.length || entry?.planes?.gov?.approvals?.length).length,
        mem: runs.filter((entry) => entry?.planes?.mem?.contextSources?.length).length,
        mirror: runs.filter((entry) => entry?.planes?.mirror?.validations?.length || entry?.planes?.mirror?.auditTrail?.length).length
      },
      recentRequests: state.recentRequests.slice(0, 12),
      highlightedRuns: runs.slice(0, 6).map((run) => ({
        taskId: run.taskId,
        label: run.label || run.codename || run.taskId,
        status: run.status,
        metrics: run.metrics,
        inspect: run.inspect
      }))
    };
    return summary;
  }

  return {
    ready,
    buildSummary,
    buildPolicySurface,
    ensureRunForTask,
    getRunSnapshot,
    hydrateFromTasks,
    ingestHttpEvent,
    ingestObserverEvent,
    ingestPermissionDecision,
    ingestWorkerExecution,
    ingestWorkerToolCall,
    listRunSnapshots,
    mergeTaskIntoRun
  };
}
