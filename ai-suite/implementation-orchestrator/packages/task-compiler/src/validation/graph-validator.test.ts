import { describe, expect, it } from "vitest";
import type { ExecutableTask, ExecutionPhase, TaskDependency } from "@implementation-orchestrator/contracts";
import { validateTaskGraph } from "./graph-validator.js";
import { DEFAULT_TASK_COMPILER_CONFIG } from "../config.js";
import { fixtureCompilationManifest } from "../test-fixtures.js";

function baseTask(overrides: Partial<ExecutableTask> & Pick<ExecutableTask, "id">): ExecutableTask {
  return {
    sourceFeatureIds: [],
    sourceRequirementIds: [],
    sourceAcceptanceCriteriaIds: [],
    sourceTestScenarioIds: [],
    phaseId: "setup",
    title: "Task",
    objective: "Do work",
    category: "dependency",
    priority: "blocking",
    builderProfile: "openhands-local",
    scope: { included: [], excluded: [], likelyFiles: [], allowedDirectories: [], forbiddenDirectories: [] },
    repositoryContext: { baseBranch: "main", workflowBranch: "automation/wf-1" },
    dependencies: [],
    acceptanceCriteria: [],
    verification: {
      checks: [
        {
          id: "git-cleanliness",
          type: "git_cleanliness",
          name: "clean",
          timeoutSeconds: 30,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    },
    execution: {
      maxBuilderAttempts: 3,
      maxRemediationCycles: 3,
      timeoutSeconds: 600,
      heartbeatIntervalSeconds: 30,
      leaseDurationSeconds: 900,
      allowNetworkAccess: false,
      allowDependencyChanges: false,
      allowSchemaChanges: false,
      requireCommit: true,
    },
    policyConstraints: [],
    expectedArtifacts: [],
    tags: [],
    ...overrides,
  };
}

const basePhases: ExecutionPhase[] = [
  { id: "setup", name: "Setup", order: -1, taskIds: ["setup.dependencies"] },
  { id: "p1", name: "Phase One", order: 0, taskIds: ["feature.f-backend", "feature.f-frontend"] },
];

function minimalValidGraph() {
  const setupTask = baseTask({ id: "setup.dependencies", category: "dependency", phaseId: "setup" });
  const backendTask = baseTask({
    id: "feature.f-backend",
    category: "api",
    phaseId: "p1",
    sourceFeatureIds: ["f-backend"],
    sourceAcceptanceCriteriaIds: ["ac1"],
    verification: {
      checks: [
        {
          id: "unit-test",
          type: "unit_test",
          name: "test",
          timeoutSeconds: 60,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    },
    dependencies: ["setup.dependencies"],
  });
  const frontendTask = baseTask({
    id: "feature.f-frontend",
    category: "frontend",
    phaseId: "p1",
    sourceFeatureIds: ["f-frontend"],
    sourceAcceptanceCriteriaIds: ["ac2"],
    verification: {
      checks: [
        {
          id: "unit-test",
          type: "unit_test",
          name: "test",
          timeoutSeconds: 60,
          required: true,
          continueOnFailure: false,
          environmentReferences: [],
          expectedExitCodes: [0],
        },
      ],
      requiredArtifactTypes: [],
      passPolicy: "all_required",
    },
    dependencies: ["setup.dependencies", "feature.f-backend"],
  });

  const tasks = [setupTask, backendTask, frontendTask];
  const dependencies: TaskDependency[] = [
    { fromTaskId: "feature.f-backend", toTaskId: "setup.dependencies", type: "hard", reason: "setup" },
    { fromTaskId: "feature.f-frontend", toTaskId: "setup.dependencies", type: "hard", reason: "setup" },
    { fromTaskId: "feature.f-frontend", toTaskId: "feature.f-backend", type: "hard", reason: "explicit" },
  ];

  return { tasks, dependencies, phases: basePhases };
}

describe("validateTaskGraph", () => {
  it("accepts a well-formed graph with full coverage", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects duplicate task ids", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    tasks.push(baseTask({ id: "feature.f-backend", category: "api", phaseId: "p1" }));
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate_task_id")).toBe(true);
  });

  it("rejects a dependency referencing a missing task", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    dependencies.push({ fromTaskId: "feature.f-backend", toTaskId: "does-not-exist", type: "hard", reason: "x" });
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_dependency_target")).toBe(true);
  });

  it("rejects a self-dependency", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    dependencies.push({ fromTaskId: "feature.f-backend", toTaskId: "feature.f-backend", type: "hard", reason: "x" });
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "self_dependency")).toBe(true);
  });

  it("rejects a hard dependency cycle", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    dependencies.push({ fromTaskId: "setup.dependencies", toTaskId: "feature.f-frontend", type: "hard", reason: "x" });
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "hard_dependency_cycle")).toBe(true);
  });

  it("rejects a task with no verification checks", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    tasks[1]!.verification.checks = [];
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "task_missing_verification")).toBe(true);
  });

  it("rejects a task referencing an unknown phase", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    tasks[1]!.phaseId = "does-not-exist";
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "task_missing_phase")).toBe(true);
  });

  it("rejects a graph with no dependency-installation task", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    const withoutSetup = tasks.filter((t) => t.id !== "setup.dependencies");
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks: withoutSetup,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_repository_setup")).toBe(true);
  });

  it("rejects a database-category task with no migration task", () => {
    const { tasks, dependencies, phases } = minimalValidGraph();
    tasks.push(baseTask({ id: "feature.f-db", category: "database", phaseId: "p1", sourceFeatureIds: ["f-backend"] }));
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks,
      dependencies,
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "database_changes_without_migration")).toBe(true);
  });

  it("rejects a graph where an essential feature has no compiled task", () => {
    const { dependencies, phases } = minimalValidGraph();
    const setupOnly = [baseTask({ id: "setup.dependencies", category: "dependency", phaseId: "setup" })];
    const result = validateTaskGraph({
      manifest: fixtureCompilationManifest(),
      tasks: setupOnly,
      dependencies: dependencies.filter((d) => d.fromTaskId === "setup.dependencies" || d.toTaskId === "setup.dependencies").filter((d) => setupOnly.some(t=>t.id===d.fromTaskId)),
      phases,
      config: DEFAULT_TASK_COMPILER_CONFIG,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "coverage_gap_essential_feature")).toBe(true);
  });
});
