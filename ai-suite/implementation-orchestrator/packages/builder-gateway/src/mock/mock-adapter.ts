import { randomUUID } from "node:crypto";
import type {
  BuilderExecutionHandle,
  BuilderExecutionStatus,
  BuilderHealth,
  BuilderResult,
  BuilderSession,
  BuilderSessionRequest,
  BuilderTaskRequest,
} from "@implementation-orchestrator/contracts";
import type { BuilderAdapter } from "../adapter.js";

export interface MockBuilderScript {
  outcome: "completed" | "failed" | "timed_out";
  changedFiles?: string[];
  summary?: string;
  delayMs?: number;
  failureMessage?: string;
}

const DEFAULT_SCRIPT: MockBuilderScript = { outcome: "completed", delayMs: 0 };

interface MockExecution {
  request: BuilderTaskRequest;
  script: MockBuilderScript;
  startedAt: number;
  cancelled: boolean;
}

export class MockBuilderAdapter implements BuilderAdapter {
  readonly id = "mock";

  private readonly executions = new Map<string, MockExecution>();
  private readonly scriptsByTaskId = new Map<string, MockBuilderScript>();

  constructor(private readonly defaultScript: MockBuilderScript = DEFAULT_SCRIPT) {}

  setScriptForTask(taskId: string, script: MockBuilderScript): void {
    this.scriptsByTaskId.set(taskId, script);
  }

  async healthCheck(): Promise<BuilderHealth> {
    return { healthy: true };
  }

  async createSession(request: BuilderSessionRequest): Promise<BuilderSession> {
    return {
      id: `mock-session-${randomUUID()}`,
      builderProfile: request.builderProfile,
      createdAt: new Date().toISOString(),
    };
  }

  async executeTask(session: BuilderSession, task: BuilderTaskRequest): Promise<BuilderExecutionHandle> {
    const executionId = `mock-exec-${randomUUID()}`;
    const script = this.scriptsByTaskId.get(task.task.id) ?? this.defaultScript;
    this.executions.set(executionId, { request: task, script, startedAt: Date.now(), cancelled: false });
    return { builderId: this.id, sessionId: session.id, executionId };
  }

  async getStatus(handle: BuilderExecutionHandle): Promise<BuilderExecutionStatus> {
    const execution = this.mustGetExecution(handle);
    if (execution.cancelled) {
      return { state: "cancelled", lastHeartbeatAt: new Date().toISOString() };
    }
    const elapsed = Date.now() - execution.startedAt;
    if (elapsed < (execution.script.delayMs ?? 0)) {
      return { state: "running", lastHeartbeatAt: new Date().toISOString() };
    }
    return { state: execution.script.outcome, lastHeartbeatAt: new Date().toISOString() };
  }

  async cancel(handle: BuilderExecutionHandle): Promise<void> {
    const execution = this.executions.get(handle.executionId);
    if (execution) {
      execution.cancelled = true;
    }
  }

  async collectResult(handle: BuilderExecutionHandle): Promise<BuilderResult> {
    const execution = this.mustGetExecution(handle);
    const { script, request } = execution;

    if (execution.cancelled) {
      return {
        status: "cancelled",
        summary: "Execution was cancelled.",
        changedFiles: [],
        createdFiles: [],
        deletedFiles: [],
        commandsRun: [],
        reportedTests: [],
        warnings: [],
      };
    }

    if (script.outcome === "completed") {
      return {
        status: "completed",
        summary: script.summary ?? `Completed task "${request.task.title}".`,
        changedFiles: script.changedFiles ?? [],
        createdFiles: [],
        deletedFiles: [],
        commandsRun: [],
        reportedTests: [],
        warnings: [],
      };
    }

    return {
      status: script.outcome,
      summary: script.summary ?? `Task "${request.task.title}" did not complete successfully.`,
      changedFiles: script.changedFiles ?? [],
      createdFiles: [],
      deletedFiles: [],
      commandsRun: [],
      reportedTests: [],
      warnings: [],
      failure: {
        code: script.outcome === "timed_out" ? "builder_timeout" : "builder_failed",
        message: script.failureMessage ?? "Mock builder scripted failure.",
      },
    };
  }

  private mustGetExecution(handle: BuilderExecutionHandle): MockExecution {
    const execution = this.executions.get(handle.executionId);
    if (!execution) {
      throw new Error(`Unknown mock execution: ${handle.executionId}`);
    }
    return execution;
  }
}
