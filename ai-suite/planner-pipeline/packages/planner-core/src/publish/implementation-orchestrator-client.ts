import type { BuildManifest, ImplementationTarget, PlanGateResult } from "@planner/contracts";

export class ImplementationOrchestratorPublishError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = "ImplementationOrchestratorPublishError";
  }
}

export interface PublishToImplementationOrchestratorArgs {
  title: string;
  manifest: BuildManifest;
  planGate: PlanGateResult;
  planId: string;
  target: ImplementationTarget;
}

export interface PublishToImplementationOrchestratorResult {
  workflowId: string;
}

export async function publishToImplementationOrchestrator(
  args: PublishToImplementationOrchestratorArgs
): Promise<PublishToImplementationOrchestratorResult> {
  const baseUrl = process.env.IMPLEMENTATION_ORCHESTRATOR_URL ?? "http://localhost:3000";
  const timeoutMs = Number(process.env.IMPLEMENTATION_ORCHESTRATOR_TIMEOUT_MS ?? 10_000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: args.title,
        manifest: { ...args.manifest, manifestId: args.planId, planGate: args.planGate },
        repository: args.target.repository,
        policyProfile: args.target.policyProfile,
        builderProfile: args.target.builderProfile
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw new ImplementationOrchestratorPublishError(
        `Publishing to implementation-orchestrator failed with ${response.status}.`,
        response.status,
        body
      );
    }

    const json = (await response.json()) as { workflowId?: string };
    if (!json.workflowId) {
      throw new ImplementationOrchestratorPublishError(
        "Publishing to implementation-orchestrator succeeded but returned no workflowId.",
        response.status,
        json
      );
    }
    return { workflowId: json.workflowId };
  } catch (error) {
    if (error instanceof ImplementationOrchestratorPublishError) throw error;
    throw new ImplementationOrchestratorPublishError(
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeout);
  }
}
