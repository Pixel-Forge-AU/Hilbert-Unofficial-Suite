const DEFAULT_CASES = [
  {
    id: "read-document-path",
    label: "Read Document Path",
    category: "envelope",
    level: 1,
    expectedTool: "read_document",
    requiredArgs: { path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md" },
    taskLine: "Read the named document path."
  },
  {
    id: "list-files-path",
    label: "List Files Path",
    category: "envelope",
    level: 1,
    expectedTool: "list_files",
    requiredArgs: { path: "/home/nova/.observer-sandbox/workspace/simple-check-project" },
    taskLine: "List the named directory path."
  },
  {
    id: "edit-file-args",
    label: "Edit File Args",
    category: "argument_fidelity",
    level: 1,
    expectedTool: "edit_file",
    requiredArgs: {
      path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md",
      oldText: "Check this box [ ]",
      newText: "Check this box [x]"
    },
    taskLine: "Prepare a surgical edit for the named file path."
  }
];

const PROMPT_VARIANTS = [
  {
    id: "exact_envelope",
    label: "Exact Envelope",
    description: "Concrete Observer envelope is shown as the final line."
  },
  {
    id: "contract_only",
    label: "Contract Only",
    description: "Uses the Observer contract with concrete args but no copyable full envelope."
  },
  {
    id: "natural_instruction",
    label: "Natural Instruction",
    description: "Asks for the tool call from a compact task instruction."
  }
];

const ISSUE_GUIDANCE = {
  invalid_json_envelope: "Tighten JSON-only instruction and keep the required object as the final prompt line.",
  repair_normalized: "Model understands the tool intent but drifts from the Observer envelope; keep repair enabled or strengthen envelope examples.",
  final_flag_wrong: "Reinforce that tool calls must use final=false until the tool result has been observed.",
  assistant_message_missing: "Keep assistant_message in the required schema example.",
  tool_call_missing: "Model is returning arguments or prose instead of a tool call; show one complete OpenAI-style tool_calls array.",
  tool_name_mismatch: "Tool selection is unstable; reduce visible tools or make the required tool name more explicit.",
  arg_mismatch: "Argument fidelity is weak; place exact arguments near the final instruction and avoid paraphrasing paths or edit text.",
  transport_fail: "Generation did not complete; inspect runtime routing, queue lane, endpoint health, or model residency before changing prompts."
};

function defaultCompactText(value = "", maxLength = 260) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeToolName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^functions?[.:/]/, "")
    .replace(/^tools?[.:/]/, "")
    .replace(/^function[._-]/, "")
    .replace(/^tool[._-]/, "")
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

function normalizePathArg(args = {}) {
  return String(args.path || args.file_path || args.filePath || args.filepath || args.target || args.file || args.filename || "").trim();
}

function buildExpectedEnvelope(testCase = {}) {
  const toolName = String(testCase.expectedTool || "").trim();
  return {
    assistant_message: "Calling the requested tool.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(testCase.requiredArgs || {})
        }
      }
    ],
    final: false
  };
}

function buildPrompt(testCase = {}, variantId = "exact_envelope") {
  const toolName = String(testCase.expectedTool || "").trim();
  const argsJson = JSON.stringify(testCase.requiredArgs || {});
  const envelopeJson = JSON.stringify(buildExpectedEnvelope(testCase));
  if (variantId === "contract_only") {
    return [
      "You are an Observer worker. Return exactly one JSON object and nothing else.",
      "When using a tool, the top-level object must contain assistant_message, tool_calls, and final=false.",
      "tool_calls must be an array of OpenAI-style function calls.",
      "function.arguments must be a JSON-encoded string, not a nested object.",
      `Call ${toolName}.`,
      testCase.taskLine,
      `Use exactly this argument object inside function.arguments: ${argsJson}`,
      "Do not return only the argument object."
    ].filter(Boolean).join("\n");
  }
  if (variantId === "natural_instruction") {
    return [
      "Return a non-final Observer tool-call JSON envelope.",
      `Use ${toolName} for this task.`,
      testCase.taskLine,
      `Arguments: ${argsJson}`,
      "No markdown. No explanation outside JSON."
    ].filter(Boolean).join("\n");
  }
  return [
    "You are being tested for Observer worker tool-call compatibility.",
    "Return exactly one JSON object and nothing else.",
    "Do not use markdown. Do not add prose before or after the JSON.",
    "Important: tool_calls must be an array. function.arguments must be a JSON-encoded string, not an object.",
    `The required tool is ${toolName}.`,
    testCase.taskLine,
    "Do not return only the argument object.",
    "Return exactly this JSON object:",
    envelopeJson
  ].filter(Boolean).join("\n");
}

function extractJsonObjectLoose(text = "") {
  const source = String(text || "").trim();
  if (!source) throw new Error("empty response");
  try {
    return JSON.parse(source);
  } catch {
    // Continue with balanced object extraction.
  }
  const start = source.indexOf("{");
  if (start < 0) throw new Error("no JSON object found");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }
  throw new Error("unterminated JSON object");
}

function parseToolArgsLoose(value = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parseToolArgsLoose(parsed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through.
  }
  if (text.startsWith("/home/nova/") || /^[A-Za-z]:[\\/]/.test(text)) return { path: text };
  return {};
}

function normalizeToolCall(call = {}, index = 0) {
  const record = call && typeof call === "object" ? call : {};
  const fn = record.function && typeof record.function === "object" ? record.function : {};
  const name = fn.name || record.name || record.function_name || record["function.name"] || "";
  const args = fn.arguments ?? record.arguments ?? record.function_arguments ?? record["function.arguments"] ?? "{}";
  return {
    id: String(record.id || `call_${index + 1}`),
    name: normalizeToolName(name),
    args: parseToolArgsLoose(args),
    rawArguments: typeof args === "string" ? args : JSON.stringify(args || {})
  };
}

function normalizeWorkoutDecisionEnvelope(decision = null) {
  if (Array.isArray(decision)) {
    return {
      decision: { assistant_message: "Calling tools.", tool_calls: decision, final: false },
      repairs: ["wrapped top-level tool call array as Observer envelope"]
    };
  }
  if (!decision || typeof decision !== "object") return { decision, repairs: [] };
  if (Array.isArray(decision.tool_calls)) return { decision, repairs: [] };
  const singleToolCallLike = (
    (typeof decision.name === "string" && ("arguments" in decision || "function" in decision))
    || (decision.function && typeof decision.function === "object")
    || (typeof decision.tool === "string" && ("arguments" in decision || "function.arguments" in decision || "path" in decision))
  );
  if (!singleToolCallLike) return { decision, repairs: [] };
  const toolName = decision.name || decision.tool || decision.function?.name || "";
  const args = decision.arguments
    ?? decision["function.arguments"]
    ?? decision.function?.arguments
    ?? Object.fromEntries(
      Object.entries(decision).filter(([key]) => !["tool", "name", "id", "type", "function", "final", "assistant_message"].includes(key))
    );
  return {
    decision: {
      assistant_message: String(decision.assistant_message || "Calling tools."),
      tool_calls: [
        {
          id: String(decision.id || "call_1"),
          type: "function",
          function: {
            name: toolName,
            arguments: typeof args === "string" ? args : JSON.stringify(args || {})
          }
        }
      ],
      final: false
    },
    repairs: ["wrapped single tool-call-shaped object as Observer envelope"]
  };
}

function gradeFromFindings({ failures = [], warnings = [], toolCalls = [], expectedTool = "" } = {}) {
  if (failures.length) {
    const hasRightTool = toolCalls.some((call) => call.name === expectedTool);
    return hasRightTool ? "partial" : "fail";
  }
  return warnings.length ? "recoverable_pass" : "strict_pass";
}

function countIssueCodes(results = []) {
  const counts = {};
  for (const result of Array.isArray(results) ? results : []) {
    for (const code of Array.isArray(result.issueCodes) ? result.issueCodes : []) {
      const key = String(code || "").trim();
      if (!key) continue;
      counts[key] = Number(counts[key] || 0) + 1;
    }
  }
  return counts;
}

function summarizeGrades(results = []) {
  const summary = {
    strict_pass: 0,
    recoverable_pass: 0,
    partial: 0,
    fail: 0,
    transport_fail: 0
  };
  for (const result of Array.isArray(results) ? results : []) {
    const grade = String(result.grade || "").trim();
    if (Object.prototype.hasOwnProperty.call(summary, grade)) summary[grade] += 1;
  }
  return summary;
}

function summarizeByKey(results = [], keyName = "") {
  const summary = {};
  for (const result of Array.isArray(results) ? results : []) {
    const key = String(result?.[keyName] || "unknown").trim() || "unknown";
    if (!summary[key]) {
      summary[key] = {
        total: 0,
        passed: 0,
        strict_pass: 0,
        recoverable_pass: 0,
        partial: 0,
        fail: 0,
        transport_fail: 0
      };
    }
    summary[key].total += 1;
    if (result?.passed === true) summary[key].passed += 1;
    const grade = String(result?.grade || "").trim();
    if (Object.prototype.hasOwnProperty.call(summary[key], grade)) summary[key][grade] += 1;
  }
  return summary;
}

function calculateWeightedScore(gradeSummary = {}, total = 0) {
  const count = Math.max(0, Number(total || 0));
  if (!count) return 0;
  const weighted = (
    Number(gradeSummary.strict_pass || 0) * 1
    + Number(gradeSummary.recoverable_pass || 0) * 0.8
    + Number(gradeSummary.partial || 0) * 0.4
  );
  return Number((weighted / count).toFixed(3));
}

function buildRecommendation(gradeSummary = {}, total = 0) {
  const strict = Number(gradeSummary.strict_pass || 0);
  const recoverable = Number(gradeSummary.recoverable_pass || 0);
  const partial = Number(gradeSummary.partial || 0);
  const fail = Number(gradeSummary.fail || 0);
  const transport = Number(gradeSummary.transport_fail || 0);
  if (!total || transport === total) return "transport unreliable";
  if (strict === total) return "safe for strict queued tools";
  if (strict + recoverable === total) return "safe with repair normalization";
  if (fail + partial > 0 && strict + recoverable > 0) return "prompt-sensitive; use for simple tools or with stronger prompting";
  if (fail + partial === total) return "use for prose only";
  return "needs more samples";
}

function issueFamily(issueCode = "") {
  const text = String(issueCode || "").trim();
  if (text.startsWith("arg_mismatch:")) return "arg_mismatch";
  return text;
}

function describeIssue(issueCode = "") {
  const family = issueFamily(issueCode);
  return ISSUE_GUIDANCE[family] || "Inspect the raw response, normalized envelope, and selected prompt variant.";
}

function summarizeVariantPerformance(variantSummary = {}) {
  const variants = Object.entries(variantSummary || {}).map(([id, summary]) => {
    const total = Math.max(0, Number(summary?.total || 0));
    const passed = Number(summary?.passed || 0);
    const strict = Number(summary?.strict_pass || 0);
    const recoverable = Number(summary?.recoverable_pass || 0);
    const partial = Number(summary?.partial || 0);
    const failed = Number(summary?.fail || 0) + Number(summary?.transport_fail || 0);
    return {
      id,
      total,
      passed,
      passRate: total ? Number((passed / total).toFixed(3)) : 0,
      strictRate: total ? Number((strict / total).toFixed(3)) : 0,
      repairRate: total ? Number((recoverable / total).toFixed(3)) : 0,
      partialRate: total ? Number((partial / total).toFixed(3)) : 0,
      failRate: total ? Number((failed / total).toFixed(3)) : 0
    };
  });
  const ranked = variants.slice().sort((a, b) => {
    if (a.passRate !== b.passRate) return b.passRate - a.passRate;
    if (a.strictRate !== b.strictRate) return b.strictRate - a.strictRate;
    return a.id.localeCompare(b.id);
  });
  const weakest = variants.slice().sort((a, b) => {
    if (a.passRate !== b.passRate) return a.passRate - b.passRate;
    if (a.strictRate !== b.strictRate) return a.strictRate - b.strictRate;
    return a.id.localeCompare(b.id);
  })[0] || null;
  return {
    variants,
    best: ranked[0] || null,
    weakest
  };
}

function buildWorkoutDiagnosis({
  gradeSummary = {},
  issueSummary = {},
  variantSummary = {},
  total = 0,
  weightedScore = 0
} = {}) {
  const issueEntries = Object.entries(issueSummary || {})
    .map(([code, count]) => ({
      code,
      count: Number(count || 0),
      guidance: describeIssue(code)
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  if (Number(gradeSummary.transport_fail || 0) > 0 && !issueEntries.some((entry) => entry.code === "transport_fail")) {
    issueEntries.push({
      code: "transport_fail",
      count: Number(gradeSummary.transport_fail || 0),
      guidance: describeIssue("transport_fail")
    });
  }
  const variantPerformance = summarizeVariantPerformance(variantSummary);
  const actions = [];
  const topIssue = issueEntries[0] || null;
  if (topIssue) actions.push(topIssue.guidance);
  if (variantPerformance.best && variantPerformance.weakest && variantPerformance.best.id !== variantPerformance.weakest.id) {
    actions.push(`Use ${variantPerformance.best.id} as the baseline prompt shape; ${variantPerformance.weakest.id} is currently weakest.`);
  }
  if (Number(weightedScore || 0) >= 1 && Number(gradeSummary.strict_pass || 0) === Number(total || 0)) {
    actions.push("Brain is strict-clean on this suite; broaden cases before changing prompts.");
  } else if (Number(gradeSummary.recoverable_pass || 0) > 0 && Number(gradeSummary.fail || 0) + Number(gradeSummary.partial || 0) === 0) {
    actions.push("Keep normalizer coverage, then test whether stronger envelope examples can convert recovered passes to strict passes.");
  } else if (Number(gradeSummary.fail || 0) + Number(gradeSummary.partial || 0) > 0) {
    actions.push("Do not route complex queued tools to this brain until the failing issue family improves.");
  }
  return {
    status: Number(weightedScore || 0) >= 1 ? "strict_clean" : (Number(weightedScore || 0) >= 0.8 ? "repair_tolerant" : (Number(weightedScore || 0) >= 0.4 ? "prompt_sensitive" : "not_tool_ready")),
    topIssues: issueEntries.slice(0, 5),
    variantPerformance,
    actions: [...new Set(actions)].slice(0, 5)
  };
}

function compactHistoryRecord(report = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  const caseIds = [...new Set(results.map((entry) => String(entry.caseId || "").trim()).filter(Boolean))];
  const variantIds = [...new Set(results.map((entry) => String(entry.variantId || "").trim()).filter(Boolean))];
  const brain = report.brain && typeof report.brain === "object" ? report.brain : {};
  return {
    id: `${String(brain.id || "brain")}:${String(report.completedAt || Date.now())}`,
    brain: {
      id: String(brain.id || "").trim(),
      label: String(brain.label || brain.id || "").trim(),
      model: String(brain.model || "").trim(),
      kind: String(brain.kind || "").trim(),
      specialty: String(brain.specialty || "").trim(),
      queueLane: String(brain.queueLane || "").trim(),
      toolCapable: brain.toolCapable === true
    },
    startedAt: Number(report.startedAt || 0),
    completedAt: Number(report.completedAt || Date.now()),
    durationMs: Number(report.durationMs || 0),
    passed: report.passed === true,
    passedCount: Number(report.passedCount || 0),
    failedCount: Number(report.failedCount || 0),
    totalCount: results.length,
    weightedScore: Number(report.weightedScore || 0),
    gradeSummary: report.gradeSummary && typeof report.gradeSummary === "object" ? report.gradeSummary : {},
    issueSummary: report.issueSummary && typeof report.issueSummary === "object" ? report.issueSummary : {},
    categorySummary: report.categorySummary && typeof report.categorySummary === "object" ? report.categorySummary : {},
    variantSummary: report.variantSummary && typeof report.variantSummary === "object" ? report.variantSummary : {},
    diagnosis: report.diagnosis && typeof report.diagnosis === "object" ? report.diagnosis : null,
    caseIds,
    variantIds,
    recommendation: String(report.recommendation || "").trim()
  };
}

function normalizeHistoryRecord(record = {}) {
  if (!record || typeof record !== "object") return null;
  const brain = record.brain && typeof record.brain === "object" ? record.brain : {};
  const brainId = String(brain.id || record.brainId || "").trim();
  if (!brainId) return null;
  return {
    id: String(record.id || `${brainId}:${record.completedAt || Date.now()}`).trim(),
    brain: {
      id: brainId,
      label: String(brain.label || record.brainLabel || brainId).trim(),
      model: String(brain.model || record.model || "").trim(),
      kind: String(brain.kind || "").trim(),
      specialty: String(brain.specialty || "").trim(),
      queueLane: String(brain.queueLane || "").trim(),
      toolCapable: brain.toolCapable === true
    },
    startedAt: Number(record.startedAt || 0),
    completedAt: Number(record.completedAt || 0),
    durationMs: Number(record.durationMs || 0),
    passed: record.passed === true,
    passedCount: Number(record.passedCount || 0),
    failedCount: Number(record.failedCount || 0),
    totalCount: Number(record.totalCount || record.passedCount + record.failedCount || 0),
    weightedScore: Number(record.weightedScore || 0),
    gradeSummary: record.gradeSummary && typeof record.gradeSummary === "object" ? record.gradeSummary : {},
    issueSummary: record.issueSummary && typeof record.issueSummary === "object" ? record.issueSummary : {},
    categorySummary: record.categorySummary && typeof record.categorySummary === "object" ? record.categorySummary : {},
    variantSummary: record.variantSummary && typeof record.variantSummary === "object" ? record.variantSummary : {},
    diagnosis: record.diagnosis && typeof record.diagnosis === "object" ? record.diagnosis : null,
    caseIds: Array.isArray(record.caseIds) ? record.caseIds.map((value) => String(value || "").trim()).filter(Boolean) : [],
    variantIds: Array.isArray(record.variantIds) ? record.variantIds.map((value) => String(value || "").trim()).filter(Boolean) : [],
    recommendation: String(record.recommendation || "").trim()
  };
}

function summarizeHistoryTrend(records = []) {
  const ordered = (Array.isArray(records) ? records : [])
    .map((record) => normalizeHistoryRecord(record))
    .filter(Boolean)
    .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0));
  const latest = ordered[0] || null;
  const previous = ordered[1] || null;
  const recent = ordered.slice(0, 5);
  const recentAverage = recent.length
    ? Number((recent.reduce((sum, record) => sum + Number(record.weightedScore || 0), 0) / recent.length).toFixed(3))
    : 0;
  const delta = latest && previous
    ? Number((Number(latest.weightedScore || 0) - Number(previous.weightedScore || 0)).toFixed(3))
    : null;
  const direction = delta == null
    ? "unknown"
    : (delta >= 0.05 ? "improved" : (delta <= -0.05 ? "regressed" : "stable"));
  let passStreak = 0;
  for (const record of ordered) {
    if (record.passed !== true) break;
    passStreak += 1;
  }
  return {
    sampleCount: ordered.length,
    latestScore: latest ? Number(latest.weightedScore || 0) : null,
    previousScore: previous ? Number(previous.weightedScore || 0) : null,
    delta,
    direction,
    recentAverage,
    passStreak,
    latestRecommendation: latest?.recommendation || ""
  };
}

function buildReadinessStatus(latest = null, trend = {}) {
  if (!latest) {
    return {
      status: "no_data",
      reason: "No saved workout runs yet."
    };
  }
  const score = Number(latest.weightedScore || 0);
  const direction = String(trend?.direction || "unknown").trim();
  const strictCount = Number(latest.gradeSummary?.strict_pass || 0);
  const totalCount = Number(latest.totalCount || 0);
  if (score >= 1 && strictCount === totalCount && direction !== "regressed") {
    return {
      status: "ready",
      reason: "Latest run was strict-clean."
    };
  }
  if (score >= 0.8 && latest.passed === true) {
    return {
      status: "usable_with_repair",
      reason: "Latest run passed with repairable envelope differences."
    };
  }
  if (score >= 0.4 || direction === "improved") {
    return {
      status: "watch",
      reason: "Latest evidence is prompt-sensitive or improving but not strict-clean."
    };
  }
  return {
    status: "avoid_for_tools",
    reason: "Latest tool-envelope evidence is weak."
  };
}

export function createBrainToolWorkoutService({
  compactText = defaultCompactText,
  getBrainQueueLane = null,
  listAvailableBrains = async () => [],
  readWorkoutHistory = async () => [],
  appendWorkoutHistory = async () => {},
  runOllamaGenerate = async () => ({ ok: false, stderr: "unavailable" })
} = {}) {
  async function listBrains() {
    const brains = await listAvailableBrains();
    return (Array.isArray(brains) ? brains : []).map((brain) => ({
      id: String(brain?.id || "").trim(),
      label: String(brain?.label || brain?.id || "").trim(),
      kind: String(brain?.kind || "").trim(),
      model: String(brain?.model || "").trim(),
      specialty: String(brain?.specialty || "").trim(),
      endpointId: String(brain?.endpointId || "").trim(),
      endpointLabel: String(brain?.endpointLabel || "").trim(),
      queueLane: String(brain?.queueLane || getBrainQueueLane?.(brain) || "").trim(),
      toolCapable: brain?.toolCapable === true,
      cronCapable: brain?.cronCapable === true
    })).filter((brain) => brain.id);
  }

  function listCases() {
    return {
      cases: DEFAULT_CASES.map((entry) => ({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        level: entry.level,
        expectedTool: entry.expectedTool
      })),
      variants: PROMPT_VARIANTS.map((entry) => ({ ...entry }))
    };
  }

  async function listHistory({ brainId = "", limit = 20 } = {}) {
    const normalizedBrainId = String(brainId || "").trim();
    const maxCount = Math.max(1, Math.min(Number(limit || 20), 200));
    const records = await readWorkoutHistory();
    return (Array.isArray(records) ? records : [])
      .map((record) => normalizeHistoryRecord(record))
      .filter(Boolean)
      .filter((record) => !normalizedBrainId || record.brain.id === normalizedBrainId)
      .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))
      .slice(0, maxCount);
  }

  async function summarizeHistory({ brainId = "", limit = 20 } = {}) {
    const history = await listHistory({ brainId, limit });
    return {
      history,
      trend: summarizeHistoryTrend(history)
    };
  }

  async function summarizeBrainReadiness({ limitPerBrain = 20 } = {}) {
    const [brains, rawHistory] = await Promise.all([
      listBrains(),
      readWorkoutHistory()
    ]);
    const normalizedRecords = (Array.isArray(rawHistory) ? rawHistory : [])
      .map((record) => normalizeHistoryRecord(record))
      .filter(Boolean);
    return brains.map((brain) => {
      const history = normalizedRecords
        .filter((record) => record.brain.id === brain.id)
        .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))
        .slice(0, Math.max(1, Math.min(Number(limitPerBrain || 20), 200)));
      const trend = summarizeHistoryTrend(history);
      const latest = history[0] || null;
      const readiness = buildReadinessStatus(latest, trend);
      return {
        brain,
        latest,
        trend,
        readiness,
        sampleCount: history.length
      };
    }).sort((a, b) => {
      const scoreA = Number(a.latest?.weightedScore ?? -1);
      const scoreB = Number(b.latest?.weightedScore ?? -1);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return String(a.brain.label || a.brain.id).localeCompare(String(b.brain.label || b.brain.id));
    });
  }

  function gradeCase({ testCase, variantId, prompt, rawText = "" } = {}) {
    const failures = [];
    const warnings = [];
    const issueCodes = [];
    let parsed = null;
    let normalizedDecision = null;
    let toolCalls = [];
    try {
      parsed = extractJsonObjectLoose(rawText);
    } catch (error) {
      failures.push(`Invalid JSON envelope: ${error.message}`);
      issueCodes.push("invalid_json_envelope");
    }
    if (parsed) {
      const normalized = normalizeWorkoutDecisionEnvelope(parsed);
      normalizedDecision = normalized.decision;
      warnings.push(...normalized.repairs);
      if (normalized.repairs.length) issueCodes.push("repair_normalized");
      if (normalizedDecision?.final !== false) {
        failures.push("Expected final=false.");
        issueCodes.push("final_flag_wrong");
      }
      if (typeof normalizedDecision?.assistant_message !== "string") {
        failures.push("assistant_message must be a string.");
        issueCodes.push("assistant_message_missing");
      }
      toolCalls = Array.isArray(normalizedDecision?.tool_calls)
        ? normalizedDecision.tool_calls.map((call, index) => normalizeToolCall(call, index))
        : [];
      if (!toolCalls.length) {
        failures.push("Expected at least one tool call.");
        issueCodes.push("tool_call_missing");
      }
    }
    const first = toolCalls[0] || null;
    if (first && first.name !== testCase.expectedTool) {
      failures.push(`Expected first tool ${testCase.expectedTool}, got ${first.name || "(none)"}.`);
      issueCodes.push("tool_name_mismatch");
    }
    if (first) {
      for (const [key, expectedValue] of Object.entries(testCase.requiredArgs || {})) {
        const actualValue = key === "path" ? normalizePathArg(first.args) : String(first.args?.[key] ?? "");
        if (String(actualValue) !== String(expectedValue)) {
          failures.push(`Expected argument ${key}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}.`);
          issueCodes.push(`arg_mismatch:${key}`);
        }
      }
    }
    const uniqueIssueCodes = [...new Set(issueCodes)];
    const grade = gradeFromFindings({ failures, warnings, toolCalls, expectedTool: testCase.expectedTool });
    return {
      id: `${testCase.id}:${variantId}`,
      caseId: testCase.id,
      variantId,
      label: testCase.label,
      category: testCase.category,
      level: testCase.level,
      passed: grade === "strict_pass" || grade === "recoverable_pass",
      grade,
      failures,
      issueCodes: uniqueIssueCodes,
      expectedTool: testCase.expectedTool,
      prompt: compactText(prompt, 4000),
      toolCalls,
      warnings,
      recovered: warnings.length > 0,
      parsedEnvelope: normalizedDecision || null,
      rawText: compactText(rawText, 4000)
    };
  }

  async function runWorkout({
    brainId = "",
    caseIds = [],
    variantIds = ["exact_envelope"],
    timeoutMs = 45000
  } = {}) {
    const normalizedBrainId = String(brainId || "").trim();
    if (!normalizedBrainId) throw new Error("brainId is required");
    const brains = await listAvailableBrains();
    const brain = (Array.isArray(brains) ? brains : []).find((entry) => String(entry?.id || "").trim() === normalizedBrainId);
    if (!brain) {
      const error = new Error(`brain not found: ${normalizedBrainId}`);
      error.status = 404;
      throw error;
    }
    const caseSet = new Set((Array.isArray(caseIds) ? caseIds : []).map((value) => String(value || "").trim()).filter(Boolean));
    const variantSet = new Set((Array.isArray(variantIds) ? variantIds : [variantIds]).map((value) => String(value || "").trim()).filter(Boolean));
    const selectedCases = DEFAULT_CASES.filter((entry) => !caseSet.size || caseSet.has(entry.id));
    const selectedVariants = PROMPT_VARIANTS.filter((entry) => !variantSet.size || variantSet.has(entry.id));
    const startedAt = Date.now();
    const results = [];
    for (const testCase of selectedCases) {
      for (const variant of selectedVariants) {
        const prompt = buildPrompt(testCase, variant.id);
        const result = await runOllamaGenerate(brain.model, prompt, {
          timeoutMs: Math.max(5000, Math.min(Number(timeoutMs || 45000), 180000)),
          keepAlive: "5m",
          options: { temperature: 0, num_predict: 512 },
          baseUrl: brain.ollamaBaseUrl || brain.baseUrl,
          provider: brain.provider,
          apiKeyEnv: brain.apiKeyEnv,
          format: "json",
          brainId: brain.id,
          laneHint: brain.queueLane || "",
          leaseOwnerId: `brain-tool-workout:${brain.id}:${Date.now()}`,
          leaseWaitMs: 5000
        });
        if (!result?.ok) {
          results.push({
            id: `${testCase.id}:${variant.id}`,
            caseId: testCase.id,
            variantId: variant.id,
            label: testCase.label,
            category: testCase.category,
            level: testCase.level,
            passed: false,
            grade: "transport_fail",
            failures: [String(result?.stderr || "model generation failed")],
            expectedTool: testCase.expectedTool,
            prompt: compactText(prompt, 4000),
            toolCalls: [],
            rawText: compactText(String(result?.text || ""), 4000),
            timedOut: result?.timedOut === true,
            busy: result?.busy === true
          });
          continue;
        }
        results.push(gradeCase({ testCase, variantId: variant.id, prompt, rawText: String(result.text || "") }));
      }
    }
    const gradeSummary = summarizeGrades(results);
    const issueSummary = countIssueCodes(results);
    const categorySummary = summarizeByKey(results, "category");
    const variantSummary = summarizeByKey(results, "variantId");
    const weightedScore = calculateWeightedScore(gradeSummary, results.length);
    const diagnosis = buildWorkoutDiagnosis({
      gradeSummary,
      issueSummary,
      variantSummary,
      total: results.length,
      weightedScore
    });
    const passedCount = results.filter((entry) => entry.passed).length;
    const completedAt = Date.now();
    const report = {
      ok: true,
      brain: {
        id: brain.id,
        label: brain.label || brain.id,
        model: brain.model,
        kind: brain.kind,
        specialty: brain.specialty || "",
        queueLane: brain.queueLane || getBrainQueueLane?.(brain) || "",
        toolCapable: brain.toolCapable === true
      },
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      passed: passedCount === results.length,
      passedCount,
      failedCount: results.length - passedCount,
      weightedScore,
      gradeSummary,
      issueSummary,
      categorySummary,
      variantSummary,
      diagnosis,
      recommendation: buildRecommendation(gradeSummary, results.length),
      results
    };
    try {
      await appendWorkoutHistory(compactHistoryRecord(report));
      report.history = { saved: true };
    } catch (error) {
      report.history = { saved: false, error: String(error?.message || error || "failed to save history") };
    }
    return report;
  }

  return {
    buildPrompt,
    gradeCase,
    listHistory,
    summarizeBrainReadiness,
    summarizeHistory,
    listBrains,
    listCases,
    runWorkout
  };
}
