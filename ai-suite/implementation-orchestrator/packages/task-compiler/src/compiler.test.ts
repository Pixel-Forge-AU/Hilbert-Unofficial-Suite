import { describe, expect, it } from "vitest";
import { DeterministicTaskCompiler } from "./compiler.js";
import { fixtureCompilationManifest, fixturePolicy, fixtureRepositoryProfile } from "./test-fixtures.js";
import { COMPILER_VERSION } from "./config.js";
import { SETUP_TASK_ID, MIGRATION_TASK_ID } from "./feature-compiler.js";
import { INTEGRATION_TASK_ID, FINAL_VERIFICATION_TASK_ID } from "./extra-task-compiler.js";

const compiler = new DeterministicTaskCompiler();

function compile(overrides: Parameters<typeof fixtureCompilationManifest>[0] = {}) {
  return compiler.compile({
    manifest: fixtureCompilationManifest(overrides),
    repository: fixtureRepositoryProfile(),
    policy: fixturePolicy(),
    compilerVersion: COMPILER_VERSION,
    defaultBuilderProfile: "openhands-local",
    workflowBranch: "automation/wf-1",
  });
}

describe("DeterministicTaskCompiler", () => {
  it("creates a setup task, one task per essential feature, an integration task, and a final verification task", async () => {
    const graph = await compile();
    const taskIds = graph.tasks.map((t) => t.id);

    expect(taskIds).toContain(SETUP_TASK_ID);
    expect(taskIds).toContain("feature.f-backend");
    expect(taskIds).toContain("feature.f-frontend");
    expect(taskIds).toContain(INTEGRATION_TASK_ID);
    expect(taskIds).toContain(FINAL_VERIFICATION_TASK_ID);
    expect(taskIds).not.toContain(MIGRATION_TASK_ID);
  });

  it("classifies feature categories from name/description keywords", async () => {
    const graph = await compile();
    const backendTask = graph.tasks.find((t) => t.id === "feature.f-backend")!;
    const frontendTask = graph.tasks.find((t) => t.id === "feature.f-frontend")!;

    expect(backendTask.category).toBe("api");
    expect(frontendTask.category).toBe("frontend");
  });

  it("creates a migration task only when the repository has detected migration commands", async () => {
    const graphWithoutMigrations = await compile();
    expect(graphWithoutMigrations.tasks.map((t) => t.id)).not.toContain(MIGRATION_TASK_ID);

    const graphWithMigrations = await compiler.compile({
      manifest: fixtureCompilationManifest(),
      repository: fixtureRepositoryProfile({
        migrationCommands: [
          { label: "migrate", command: "npm run migrate", workingDirectory: "/tmp/fixture-repo", source: "package_script" },
        ],
      }),
      policy: fixturePolicy(),
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: "openhands-local",
      workflowBranch: "automation/wf-1",
    });
    expect(graphWithMigrations.tasks.map((t) => t.id)).toContain(MIGRATION_TASK_ID);
  });

  it("hard-depends every feature task on the setup task, and the final verification task on everything else", async () => {
    const graph = await compile();
    const backendTask = graph.tasks.find((t) => t.id === "feature.f-backend")!;
    const finalTask = graph.tasks.find((t) => t.id === FINAL_VERIFICATION_TASK_ID)!;

    expect(backendTask.dependencies).toContain(SETUP_TASK_ID);
    for (const task of graph.tasks) {
      if (task.id === FINAL_VERIFICATION_TASK_ID) continue;
      expect(finalTask.dependencies).toContain(task.id);
    }
  });

  it("respects explicit manifest feature dependencies as hard edges", async () => {
    const graph = await compile();
    const frontendTask = graph.tasks.find((t) => t.id === "feature.f-frontend")!;
    expect(frontendTask.dependencies).toContain("feature.f-backend");
  });

  it("splits a feature with more acceptance criteria than the configured threshold", async () => {
    const manyAcceptanceCriteria = Array.from({ length: 10 }, (_, i) => ({
      id: `ac-${i}`,
      description: `criterion ${i}`,
      required: true,
    }));
    const graph = await compiler.compile({
      manifest: fixtureCompilationManifest({
        features: [
          {
            id: "f-big",
            name: "Big Backend Feature",
            description: "A large backend feature.",
            priority: "essential",
            dependsOn: [],
            acceptanceCriteria: manyAcceptanceCriteria,
            testScenarios: [],
          },
        ],
        phases: [{ id: "p1", name: "Phase One", order: 0, featureIds: ["f-big"], dependsOn: [] }],
      }),
      repository: fixtureRepositoryProfile(),
      policy: fixturePolicy(),
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: "openhands-local",
      workflowBranch: "automation/wf-1",
    });

    const splitTasks = graph.tasks.filter((t) => t.sourceFeatureIds.includes("f-big"));
    expect(splitTasks).toHaveLength(2);
    expect(splitTasks[1]?.dependencies).toContain(splitTasks[0]?.id);
    expect(graph.warnings.some((w) => w.code === "feature_split")).toBe(true);
  });

  it("does not create an integration task when there is no frontend/backend boundary", async () => {
    const graph = await compiler.compile({
      manifest: fixtureCompilationManifest({
        features: [
          {
            id: "f-backend",
            name: "Backend Only",
            description: "Backend service work.",
            priority: "essential",
            dependsOn: [],
            acceptanceCriteria: [{ id: "ac1", description: "works", required: true }],
            testScenarios: [],
          },
        ],
        phases: [{ id: "p1", name: "Phase One", order: 0, featureIds: ["f-backend"], dependsOn: [] }],
      }),
      repository: fixtureRepositoryProfile(),
      policy: fixturePolicy(),
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: "openhands-local",
      workflowBranch: "automation/wf-1",
    });

    expect(graph.tasks.map((t) => t.id)).not.toContain(INTEGRATION_TASK_ID);
  });

  it("reports full coverage for a manifest whose essential features are all compiled", async () => {
    const graph = await compile();
    expect(graph.coverage.essentialFeaturesCovered).toBe(1);
    expect(graph.coverage.acceptanceCriteriaCovered).toBe(1);
    expect(graph.coverage.testScenariosCovered).toBe(1);
    expect(graph.coverage.unresolvedItems).toHaveLength(0);
  });

  it("excludes optional features from compilation entirely", async () => {
    const graph = await compiler.compile({
      manifest: fixtureCompilationManifest({
        features: [
          {
            id: "f-backend",
            name: "Backend API",
            description: "Implement the backend API endpoint.",
            priority: "essential",
            dependsOn: [],
            acceptanceCriteria: [{ id: "ac1", description: "works", required: true }],
            testScenarios: [],
          },
          {
            id: "f-optional",
            name: "Optional Nice-to-have",
            description: "Some optional UI polish.",
            priority: "optional",
            dependsOn: [],
            acceptanceCriteria: [],
            testScenarios: [],
          },
        ],
        phases: [{ id: "p1", name: "Phase One", order: 0, featureIds: ["f-backend", "f-optional"], dependsOn: [] }],
      }),
      repository: fixtureRepositoryProfile(),
      policy: fixturePolicy(),
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: "openhands-local",
      workflowBranch: "automation/wf-1",
    });

    expect(graph.tasks.some((t) => t.sourceFeatureIds.includes("f-optional"))).toBe(false);
  });

  it("places a feature not referenced by any phase into the synthetic unphased phase", async () => {
    const graph = await compiler.compile({
      manifest: fixtureCompilationManifest({
        phases: [{ id: "p1", name: "Phase One", order: 0, featureIds: ["f-backend"], dependsOn: [] }],
      }),
      repository: fixtureRepositoryProfile(),
      policy: fixturePolicy(),
      compilerVersion: COMPILER_VERSION,
      defaultBuilderProfile: "openhands-local",
      workflowBranch: "automation/wf-1",
    });

    const frontendTask = graph.tasks.find((t) => t.id === "feature.f-frontend")!;
    expect(frontendTask.phaseId).toBe("unphased");
    expect(graph.phases.find((p) => p.id === "unphased")?.taskIds).toContain(frontendTask.id);
  });
});
