import assert from "node:assert/strict";
import test from "node:test";
import { createBrainToolWorkoutService } from "./brain-tool-workout-service.js";

function createMockService(responseText = "", { ok = true, stderr = "" } = {}) {
  return createBrainToolWorkoutService({
    compactText: (value = "") => String(value || ""),
    getBrainQueueLane: (brain) => String(brain?.queueLane || ""),
    listAvailableBrains: async () => [
      {
        id: "mock_worker",
        label: "Mock Worker",
        kind: "worker",
        model: "mock:model",
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        queueLane: "mock_lane",
        toolCapable: true
      }
    ],
    runOllamaGenerate: async () => ({
      ok,
      text: responseText,
      stderr
    })
  });
}

function createMockServiceWithHistory(responseText = "") {
  const history = [];
  const service = createBrainToolWorkoutService({
    compactText: (value = "") => String(value || ""),
    getBrainQueueLane: (brain) => String(brain?.queueLane || ""),
    listAvailableBrains: async () => [
      {
        id: "mock_worker",
        label: "Mock Worker",
        kind: "worker",
        model: "mock:model",
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        queueLane: "mock_lane",
        toolCapable: true
      },
      {
        id: "other_worker",
        label: "Other Worker",
        kind: "worker",
        model: "other:model",
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        queueLane: "other_lane",
        toolCapable: true
      }
    ],
    readWorkoutHistory: async () => history,
    appendWorkoutHistory: async (record) => {
      history.push(record);
    },
    runOllamaGenerate: async () => ({
      ok: true,
      text: responseText,
      stderr: ""
    })
  });
  return { service, history };
}

test("brain tool workout grades exact Observer envelope as strict_pass", async () => {
  const service = createMockService(JSON.stringify({
    assistant_message: "Calling the requested tool.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "read_document",
          arguments: JSON.stringify({ path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md" })
        }
      }
    ],
    final: false
  }));

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.results[0].grade, "strict_pass");
  assert.equal(report.recommendation, "safe for strict queued tools");
  assert.equal(report.weightedScore, 1);
  assert.equal(report.categorySummary.envelope.total, 1);
  assert.equal(report.categorySummary.envelope.strict_pass, 1);
  assert.equal(report.variantSummary.exact_envelope.total, 1);
});

test("brain tool workout grades flat tool object as recoverable_pass", async () => {
  const service = createMockService(JSON.stringify({
    tool: "read_document",
    path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md"
  }));

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.results[0].grade, "recoverable_pass");
  assert.equal(report.results[0].recovered, true);
  assert.deepEqual(report.results[0].issueCodes, ["repair_normalized"]);
  assert.equal(report.issueSummary.repair_normalized, 1);
  assert.equal(report.recommendation, "safe with repair normalization");
  assert.equal(report.weightedScore, 0.8);
  assert.equal(report.diagnosis.status, "repair_tolerant");
  assert.equal(report.diagnosis.topIssues[0].code, "repair_normalized");
  assert.match(report.diagnosis.topIssues[0].guidance, /Observer envelope/);
});

test("brain tool workout grades args-only object as fail", async () => {
  const service = createMockService(JSON.stringify({
    path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md"
  }));

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.results[0].grade, "fail");
  assert.ok(report.results[0].issueCodes.includes("tool_call_missing"));
  assert.equal(report.issueSummary.tool_call_missing, 1);
  assert.equal(report.recommendation, "use for prose only");
});

test("brain tool workout grades wrong args on right tool as partial", async () => {
  const service = createMockService(JSON.stringify({
    assistant_message: "Calling.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "read_document",
          arguments: JSON.stringify({ path: "/wrong/path.md" })
        }
      }
    ],
    final: false
  }));

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.results[0].grade, "partial");
  assert.ok(report.results[0].issueCodes.includes("arg_mismatch:path"));
  assert.equal(report.issueSummary["arg_mismatch:path"], 1);
  assert.equal(report.weightedScore, 0.4);
  assert.equal(report.diagnosis.status, "prompt_sensitive");
  assert.equal(report.diagnosis.topIssues[0].code, "arg_mismatch:path");
  assert.match(report.diagnosis.actions.join(" "), /failing issue family/);
});

test("brain tool workout records transport failures separately", async () => {
  const service = createMockService("", { ok: false, stderr: "Ollama resource local:gpu is busy" });

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.results[0].grade, "transport_fail");
  assert.equal(report.issueSummary.transport_fail, undefined);
  assert.equal(report.recommendation, "transport unreliable");
});

test("brain tool workout saves compact history records and filters by brain", async () => {
  const { service, history } = createMockServiceWithHistory(JSON.stringify({
    assistant_message: "Calling the requested tool.",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "read_document",
          arguments: JSON.stringify({ path: "/home/nova/.observer-sandbox/workspace/simple-check-project/directive.md" })
        }
      }
    ],
    final: false
  }));

  const report = await service.runWorkout({
    brainId: "mock_worker",
    caseIds: ["read-document-path"],
    variantIds: ["exact_envelope"]
  });

  assert.equal(report.history.saved, true);
  assert.equal(history.length, 1);
  assert.equal(history[0].brain.id, "mock_worker");
  assert.equal(history[0].weightedScore, 1);
  assert.deepEqual(history[0].caseIds, ["read-document-path"]);
  assert.deepEqual(history[0].variantIds, ["exact_envelope"]);

  history.push({
    id: "other",
    brain: { id: "other_worker", label: "Other Worker" },
    completedAt: Date.now() + 1,
    weightedScore: 0,
    passedCount: 0,
    failedCount: 1,
    totalCount: 1
  });

  const mockHistory = await service.listHistory({ brainId: "mock_worker", limit: 5 });
  assert.equal(mockHistory.length, 1);
  assert.equal(mockHistory[0].brain.id, "mock_worker");
});

test("brain tool workout summarizes recent history trend", async () => {
  const { service, history } = createMockServiceWithHistory("{}");
  const now = Date.now();
  history.push(
    {
      id: "older",
      brain: { id: "mock_worker", label: "Mock Worker" },
      completedAt: now - 2000,
      weightedScore: 0.4,
      passed: false,
      passedCount: 1,
      failedCount: 1,
      totalCount: 2,
      recommendation: "prompt-sensitive"
    },
    {
      id: "latest",
      brain: { id: "mock_worker", label: "Mock Worker" },
      completedAt: now - 1000,
      weightedScore: 0.8,
      passed: true,
      passedCount: 2,
      failedCount: 0,
      totalCount: 2,
      recommendation: "safe with repair normalization"
    },
    {
      id: "other",
      brain: { id: "other_worker", label: "Other Worker" },
      completedAt: now,
      weightedScore: 0,
      passed: false,
      passedCount: 0,
      failedCount: 2,
      totalCount: 2
    }
  );

  const summary = await service.summarizeHistory({ brainId: "mock_worker", limit: 10 });
  assert.equal(summary.history.length, 2);
  assert.equal(summary.trend.sampleCount, 2);
  assert.equal(summary.trend.latestScore, 0.8);
  assert.equal(summary.trend.previousScore, 0.4);
  assert.equal(summary.trend.delta, 0.4);
  assert.equal(summary.trend.direction, "improved");
  assert.equal(summary.trend.passStreak, 1);
});

test("brain tool workout summarizes readiness for configured brains", async () => {
  const { service, history } = createMockServiceWithHistory("{}");
  const now = Date.now();
  history.push(
    {
      id: "mock-ready",
      brain: { id: "mock_worker", label: "Mock Worker", model: "mock:model" },
      completedAt: now,
      weightedScore: 1,
      passed: true,
      passedCount: 2,
      failedCount: 0,
      totalCount: 2,
      gradeSummary: { strict_pass: 2 },
      recommendation: "safe for strict queued tools"
    },
    {
      id: "other-watch",
      brain: { id: "other_worker", label: "Other Worker", model: "other:model" },
      completedAt: now - 1000,
      weightedScore: 0.4,
      passed: false,
      passedCount: 1,
      failedCount: 1,
      totalCount: 2,
      gradeSummary: { partial: 1, fail: 1 },
      recommendation: "prompt-sensitive"
    }
  );

  const readiness = await service.summarizeBrainReadiness();
  assert.equal(readiness.length, 2);
  assert.equal(readiness[0].brain.id, "mock_worker");
  assert.equal(readiness[0].readiness.status, "ready");
  assert.equal(readiness[0].latest.weightedScore, 1);
  assert.equal(readiness[1].brain.id, "other_worker");
  assert.equal(readiness[1].readiness.status, "watch");
});
