import { describe, expect, it } from "vitest";
import type { BuilderTaskRequest } from "@implementation-orchestrator/contracts";
import { MockBuilderAdapter } from "./mock-adapter.js";

function fixtureTaskRequest(taskId: string): BuilderTaskRequest {
  return {
    workflowId: "wf-1",
    workspacePath: "/tmp/fixture-workspace",
    repositoryProfile: {
      repositoryUrl: "/tmp/fixture-repo",
      baseBranch: "main",
      commitSha: "a".repeat(40),
      cleanWorkingTree: true,
      languages: [],
      frameworks: [],
      packageManagers: [],
      buildCommands: [],
      testCommands: [],
      lintCommands: [],
      typecheckCommands: [],
      migrationCommands: [],
      startCommands: [],
      directories: [],
      ciSystems: [],
      databaseSystems: [],
      environmentFiles: [],
      architectureMarkers: [],
      risks: [],
      unknowns: [],
    },
    previousAttempts: [],
    task: {
      id: taskId,
      sourceFeatureIds: [],
      sourceRequirementIds: [],
      sourceAcceptanceCriteriaIds: [],
      sourceTestScenarioIds: [],
      phaseId: "p1",
      title: "Fixture Task",
      objective: "Do fixture work",
      category: "backend",
      priority: "essential",
      builderProfile: "mock",
      scope: { included: [], excluded: [], likelyFiles: [], allowedDirectories: [], forbiddenDirectories: [] },
      repositoryContext: { baseBranch: "main", workflowBranch: "automation/wf-1" },
      dependencies: [],
      acceptanceCriteria: [],
      verification: { checks: [], requiredArtifactTypes: [], passPolicy: "all_required" },
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
    },
  };
}

describe("MockBuilderAdapter", () => {
  it("reports healthy", async () => {
    const adapter = new MockBuilderAdapter();
    await expect(adapter.healthCheck()).resolves.toEqual({ healthy: true });
  });

  it("completes a task successfully by default", async () => {
    const adapter = new MockBuilderAdapter();
    const session = await adapter.createSession({ workflowId: "wf-1", workspacePath: "/tmp", builderProfile: "mock" });
    const handle = await adapter.executeTask(session, fixtureTaskRequest("task-1"));

    const status = await adapter.getStatus(handle);
    expect(status.state).toBe("completed");

    const result = await adapter.collectResult(handle);
    expect(result.status).toBe("completed");
  });

  it("reports running until a configured delay elapses", async () => {
    const adapter = new MockBuilderAdapter();
    adapter.setScriptForTask("task-2", { outcome: "completed", delayMs: 50 });
    const session = await adapter.createSession({ workflowId: "wf-1", workspacePath: "/tmp", builderProfile: "mock" });
    const handle = await adapter.executeTask(session, fixtureTaskRequest("task-2"));

    expect((await adapter.getStatus(handle)).state).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await adapter.getStatus(handle)).state).toBe("completed");
  });

  it("reports a scripted failure with a failure code", async () => {
    const adapter = new MockBuilderAdapter();
    adapter.setScriptForTask("task-3", { outcome: "failed", failureMessage: "build broke" });
    const session = await adapter.createSession({ workflowId: "wf-1", workspacePath: "/tmp", builderProfile: "mock" });
    const handle = await adapter.executeTask(session, fixtureTaskRequest("task-3"));

    const result = await adapter.collectResult(handle);
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toBe("build broke");
  });

  it("reports cancelled after cancel() is called", async () => {
    const adapter = new MockBuilderAdapter();
    const session = await adapter.createSession({ workflowId: "wf-1", workspacePath: "/tmp", builderProfile: "mock" });
    const handle = await adapter.executeTask(session, fixtureTaskRequest("task-4"));

    await adapter.cancel(handle);
    expect((await adapter.getStatus(handle)).state).toBe("cancelled");
    expect((await adapter.collectResult(handle)).status).toBe("cancelled");
  });

  it("throws for an unknown execution handle", async () => {
    const adapter = new MockBuilderAdapter();
    await expect(adapter.getStatus({ builderId: "mock", sessionId: "s", executionId: "unknown" })).rejects.toThrow();
  });
});
