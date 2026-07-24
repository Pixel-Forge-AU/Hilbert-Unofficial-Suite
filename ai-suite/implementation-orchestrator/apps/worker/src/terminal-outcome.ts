import { workflowsCompletedTotal, workflowsFailedTotal } from "@implementation-orchestrator/observability";
import type { ArtifactService, WorkflowService } from "@implementation-orchestrator/orchestrator-core";
import type { WorkflowCompletionSummary, WorkflowFailure } from "@implementation-orchestrator/contracts";

export interface TerminalOutcomeDependencies {
  workflowService: WorkflowService;
  artifactService: ArtifactService;
}

async function storeTerminalWorkflowArtifact(
  deps: TerminalOutcomeDependencies,
  workflowId: string,
  data: WorkflowFailure | WorkflowCompletionSummary,
): Promise<void> {
  await deps.artifactService.storeJson({ workflowId, artifactType: "workflow_summary", data });
}

export async function recordTerminalOutcome(
  deps: TerminalOutcomeDependencies,
  workflowId: string,
  workflowFailure: WorkflowFailure | null,
): Promise<void> {
  if (workflowFailure) {
    workflowsFailedTotal.inc();
    await storeTerminalWorkflowArtifact(deps, workflowId, workflowFailure);
    return;
  }
  const completionSummary = await deps.workflowService.evaluateCompletionAfterTaskAcceptance(workflowId);
  if (completionSummary) {
    workflowsCompletedTotal.inc();
    await storeTerminalWorkflowArtifact(deps, workflowId, completionSummary);
  }
}
