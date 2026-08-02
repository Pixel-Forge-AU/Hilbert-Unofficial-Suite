import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createObserverProjectCycleInspection } from "./observer-project-cycle-inspection.js";

function createInspectionSupport() {
  return createObserverProjectCycleInspection({
    classifyFailureText: () => "unknown",
    compactTaskText: (value = "", limit = 1000) => String(value || "").slice(0, limit),
    extractContainerPathCandidates: (value = "") => [String(value || "").trim()].filter(Boolean),
    normalizeContainerMountPathCandidate: (value = "") => String(value || "").trim().replace(/\\/g, "/"),
    normalizeTaskDirectivePath: (value = "") => String(value || "").trim().replace(/\\/g, "/").replace(/[)."'\`,;:!?]+$/g, ""),
    path: path.posix
  });
}

function buildProjectMessage(objective) {
  return [
    "Advance the project simple-check-project in /home/nova/.observer-sandbox/workspace/projects/simple-check-project.",
    "This is a focused project work package, not a full project sweep.",
    `Objective: ${objective}`,
    "Project root: /home/nova/.observer-sandbox/workspace/projects/simple-check-project.",
    "Inspect first: /home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json",
    "Required planning files: /home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.",
    "Expected first move: Read /home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json before deciding on further edits."
  ].join("\n");
}

function buildReviewMessage(objective) {
  return [
    "Advance the project simple-check-project in /home/nova/.observer-sandbox/workspace/projects/simple-check-project.",
    "This is a focused project work package, not a full project sweep.",
    `Objective: ${objective}`,
    "Project root: /home/nova/.observer-sandbox/workspace/projects/simple-check-project.",
    "Inspect first: /home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js",
    "Required planning files: /home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.",
    "Expected first move: Read /home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js before deciding on further edits."
  ].join("\n");
}

test("project-cycle completion allows validation-only finish for verification objectives", () => {
  const support = createInspectionSupport();
  const message = buildProjectMessage("Verify the package test suite passes with npm test.");
  const policy = support.buildProjectCycleCompletionPolicy(message);
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "I ran npm test and verified the package test suite passed.",
    inspectedTargets: [
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json"
    ],
    successfulToolNames: ["read_document", "shell_command"]
  });

  assert.equal(policy.allowsValidationOnlyOutcome, true);
  assert.equal(state.hasMachineVerifiableValidation, true);
  assert.equal(state.eligibleForCompletion, true);
  assert.equal(state.blockingCodes.includes("missing_machine_verifiable_outcome"), false);
});

test("project-cycle completion keeps edit objectives from passing as validation-only work", () => {
  const support = createInspectionSupport();
  const message = buildProjectMessage("Complete the unchecked directive item in directive.md: Check this box.");
  const policy = support.buildProjectCycleCompletionPolicy(message);
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "I ran a shell check and verified the current directive state.",
    inspectedTargets: [
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
    ],
    successfulToolNames: ["read_document", "shell_command"]
  });

  assert.equal(policy.allowsValidationOnlyOutcome, false);
  assert.equal(state.hasMachineVerifiableValidation, false);
  assert.equal(state.eligibleForCompletion, false);
  assert.ok(state.blockingCodes.includes("missing_concrete_project_change"));
  assert.ok(state.blockingCodes.includes("missing_machine_verifiable_outcome"));
});

test("project-cycle completion rejects vague validation-only summaries without outcomes", () => {
  const support = createInspectionSupport();
  const message = buildProjectMessage("Verify the package test suite passes with npm test.");
  const policy = support.buildProjectCycleCompletionPolicy(message);
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "I checked the package test suite.",
    inspectedTargets: [
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json"
    ],
    successfulToolNames: ["read_document", "shell_command"]
  });

  assert.equal(policy.allowsValidationOnlyOutcome, true);
  assert.equal(state.hasMachineVerifiableValidation, false);
  assert.equal(state.eligibleForCompletion, false);
  assert.ok(state.blockingCodes.includes("missing_machine_verifiable_outcome"));
});

test("project-cycle no-change completion requires naming each required inspected target", () => {
  const support = createInspectionSupport();
  const message = buildReviewMessage("Review the current implementation and report whether any safe change is needed.");
  const policy = support.buildProjectCycleCompletionPolicy(message, { minimumConcreteTargets: 3 });
  const inspectedTargets = [
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/router.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json"
  ];
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: [
      "No change is possible after inspecting these paths:",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js,",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/router.js,",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json."
    ].join(" "),
    inspectedTargets,
    successfulToolNames: ["read_document", "read_document", "read_document"]
  });

  assert.equal(state.namedInspectedTargetCount, 3);
  assert.equal(state.namesInspectedTargets, true);
  assert.equal(state.eligibleForCompletion, true);
});

test("project-cycle no-change completion accepts natural safe-change wording", () => {
  const support = createInspectionSupport();
  const message = buildReviewMessage("Review the current implementation and report whether any safe change is needed.");
  const policy = support.buildProjectCycleCompletionPolicy(message, { minimumConcreteTargets: 3 });
  const inspectedTargets = [
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/router.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json"
  ];
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: [
      "No safe change is needed after inspecting:",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js,",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/router.js,",
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json."
    ].join(" "),
    inspectedTargets,
    successfulToolNames: ["read_document", "read_document", "read_document"]
  });

  assert.equal(state.hasNoChangeConclusion, true);
  assert.equal(state.namesInspectedTargets, true);
  assert.equal(state.eligibleForCompletion, true);
});

test("project-cycle no-change completion rejects naming only one inspected target", () => {
  const support = createInspectionSupport();
  const message = buildReviewMessage("Review the current implementation and report whether any safe change is needed.");
  const policy = support.buildProjectCycleCompletionPolicy(message, { minimumConcreteTargets: 3 });
  const inspectedTargets = [
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/router.js",
    "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/package.json"
  ];
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "No change is possible after inspecting /home/nova/.observer-sandbox/workspace/projects/simple-check-project/src/app.js.",
    inspectedTargets,
    successfulToolNames: ["read_document", "read_document", "read_document"]
  });

  assert.equal(state.namedInspectedTargetCount, 1);
  assert.equal(state.namesInspectedTargets, false);
  assert.equal(state.eligibleForCompletion, false);
  assert.ok(state.blockingCodes.includes("no_change_missing_named_targets"));
});

test("project-cycle completion accepts concrete changes when final text names the changed target", () => {
  const support = createInspectionSupport();
  const message = buildProjectMessage("Complete the unchecked directive item in directive.md: Check this box.");
  const policy = support.buildProjectCycleCompletionPolicy(message);
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "I checked the box in directive.md and updated PROJECT-TODO.md.",
    inspectedTargets: [
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
    ],
    successfulToolNames: ["read_document", "edit_file", "edit_file"],
    changedWorkspaceFiles: [
      { containerPath: "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/directive.md" },
      { containerPath: "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md" }
    ]
  });

  assert.ok(state.namedChangedConcreteProjectFileCount >= 1);
  assert.equal(state.eligibleForCompletion, true);
  assert.equal(state.blockingCodes.includes("final_missing_changed_project_target"), false);
});

test("project-cycle completion rejects concrete changes when final text omits the changed target", () => {
  const support = createInspectionSupport();
  const message = buildProjectMessage("Complete the unchecked directive item in directive.md: Check this box.");
  const policy = support.buildProjectCycleCompletionPolicy(message);
  const state = support.evaluateProjectCycleCompletionState({
    policy,
    finalText: "I completed the requested project update and updated the tracking file.",
    inspectedTargets: [
      "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
    ],
    successfulToolNames: ["read_document", "edit_file", "edit_file"],
    changedWorkspaceFiles: [
      { containerPath: "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/directive.md" },
      { containerPath: "/home/nova/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md" }
    ]
  });

  assert.equal(state.namedChangedConcreteProjectFileCount, 0);
  assert.equal(state.eligibleForCompletion, false);
  assert.ok(state.blockingCodes.includes("final_missing_changed_project_target"));
});
