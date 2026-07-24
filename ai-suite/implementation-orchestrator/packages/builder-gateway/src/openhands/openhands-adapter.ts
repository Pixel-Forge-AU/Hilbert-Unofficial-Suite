import { randomUUID } from "node:crypto";
import nodePath from "node:path";
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
import { buildTaskPrompt } from "./prompt.js";
import { mapExecutionStatus, type ConversationExecutionStatus } from "./status-mapping.js";

export interface OpenHandsAdapterConfig {
  baseUrl: string;
  sessionApiKey?: string;
  llmModel: string;
  llmApiKey: string;
  llmBaseUrl?: string;
  llmUsageId?: string;
  requestTimeoutMs?: number;
  /**
   * The agent server runs in its own container/filesystem, so a task's
   * `workspacePath` (a path on the host running this worker) must be
   * translated to the equivalent path inside that environment. Both must be
   * set for translation to occur; a bind mount must map `hostWorkspaceRoot`
   * onto `containerWorkspaceRoot`. If either is missing, `workspacePath` is
   * passed through unchanged (e.g. when the agent server shares the host
   * filesystem directly).
   */
  hostWorkspaceRoot?: string;
  containerWorkspaceRoot?: string;
}

export class OpenHandsRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`OpenHands request failed: ${method} ${path} -> ${statusCode}: ${body}`);
    this.name = "OpenHandsRequestError";
  }
}

interface ConversationInfoResponse {
  id: string;
  execution_status: ConversationExecutionStatus;
  title?: string | null;
}

export class OpenHandsAdapter implements BuilderAdapter {
  readonly id = "openhands";

  constructor(private readonly config: OpenHandsAdapterConfig) {}

  async healthCheck(): Promise<BuilderHealth> {
    try {
      const response = await this.request("GET", "/health");
      if (!response.ok) {
        return { healthy: false, details: `HTTP ${response.status}` };
      }
      const body = (await response.json()) as { status?: string };
      return { healthy: body.status === "ok", details: JSON.stringify(body) };
    } catch (error) {
      return { healthy: false, details: error instanceof Error ? error.message : String(error) };
    }
  }

  async createSession(request: BuilderSessionRequest): Promise<BuilderSession> {
    // OpenHands has no session concept distinct from a conversation; each task
    // execution creates its own conversation, so this is a lightweight local handle.
    return {
      id: `openhands-session-${randomUUID()}`,
      builderProfile: request.builderProfile,
      createdAt: new Date().toISOString(),
    };
  }

  async executeTask(session: BuilderSession, task: BuilderTaskRequest): Promise<BuilderExecutionHandle> {
    const response = await this.request("POST", "/api/conversations", {
      workspace: { working_dir: this.toContainerPath(task.workspacePath), kind: "LocalWorkspace" },
      initial_message: { content: [{ text: buildTaskPrompt(task) }] },
      agent: {
        kind: "Agent",
        llm: {
          model: this.config.llmModel,
          api_key: this.config.llmApiKey,
          base_url: this.config.llmBaseUrl,
          usage_id: this.config.llmUsageId ?? "implementation-orchestrator",
        },
        tools: [{ name: "terminal" }, { name: "file_editor" }],
      },
    });
    if (!response.ok) {
      throw new OpenHandsRequestError("POST", "/api/conversations", response.status, await safeText(response));
    }
    const conversation = (await response.json()) as ConversationInfoResponse;

    const runResponse = await this.request("POST", `/api/conversations/${conversation.id}/run`);
    if (!runResponse.ok && runResponse.status !== 409) {
      throw new OpenHandsRequestError(
        "POST",
        `/api/conversations/${conversation.id}/run`,
        runResponse.status,
        await safeText(runResponse),
      );
    }

    return { builderId: this.id, sessionId: session.id, executionId: conversation.id };
  }

  async getStatus(handle: BuilderExecutionHandle): Promise<BuilderExecutionStatus> {
    const info = await this.getConversation(handle.executionId);
    return { state: mapExecutionStatus(info.execution_status), lastHeartbeatAt: new Date().toISOString() };
  }

  async cancel(handle: BuilderExecutionHandle): Promise<void> {
    await this.request("POST", `/api/conversations/${handle.executionId}/interrupt`);
  }

  async collectResult(handle: BuilderExecutionHandle): Promise<BuilderResult> {
    const info = await this.getConversation(handle.executionId);
    const state = mapExecutionStatus(info.execution_status);
    const status = state === "queued" || state === "running" ? "failed" : state;

    return {
      status,
      summary: info.title ?? `OpenHands conversation ${handle.executionId} ended as "${info.execution_status}".`,
      // Changed files and the resulting commit are independently re-derived by the
      // orchestrator from the actual git working tree, not trusted from the builder's
      // own report (spec section 3.2: builders never approve their own work).
      changedFiles: [],
      createdFiles: [],
      deletedFiles: [],
      commandsRun: [],
      reportedTests: [],
      warnings: [],
      failure:
        status === "completed"
          ? undefined
          : {
              code: `openhands_${info.execution_status}`,
              message: `Conversation ended with execution_status "${info.execution_status}".`,
            },
    };
  }

  private toContainerPath(hostPath: string): string {
    if (!this.config.hostWorkspaceRoot || !this.config.containerWorkspaceRoot) {
      return hostPath;
    }
    const relative = nodePath.relative(this.config.hostWorkspaceRoot, hostPath).split(nodePath.sep).join("/");
    return `${this.config.containerWorkspaceRoot.replace(/\/+$/, "")}/${relative}`;
  }

  private async getConversation(conversationId: string): Promise<ConversationInfoResponse> {
    const response = await this.request("GET", `/api/conversations/${conversationId}`);
    if (!response.ok) {
      throw new OpenHandsRequestError(
        "GET",
        `/api/conversations/${conversationId}`,
        response.status,
        await safeText(response),
      );
    }
    return (await response.json()) as ConversationInfoResponse;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.sessionApiKey) {
      headers["X-Session-API-Key"] = this.config.sessionApiKey;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? 30_000);
    try {
      return await fetch(new URL(path, this.config.baseUrl), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}
