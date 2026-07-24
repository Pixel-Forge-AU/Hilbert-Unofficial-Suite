import type {
  PlannerStageName,
  StageSummary,
  StageOutputByName
} from "@planner/contracts";
import type { LlmProvider, TokenBudget } from "@planner/llm";

export interface PlannerLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (bindings: Record<string, unknown>) => PlannerLogger;
}

export interface StageRuntime {
  planId: string;
  attempt: number;
  model: LlmProvider;
  abortSignal: AbortSignal;
  logger: PlannerLogger;
  tokenBudget: TokenBudget;
}

export interface PlannerContext {
  plan: unknown;
  previousOutputs: Partial<StageOutputByName> & Record<string, unknown>;
  revisionRequests: unknown[];
  /** This stage's own most recently produced output, if it has run before - see PromptContext.previousStageOutput. */
  previousStageOutput?: unknown;
  /** Every revision request ever raised against this stage across the whole plan, oldest first - see PromptContext.resolvedIssues. */
  resolvedIssues?: unknown[];
}

export interface PlannerStage<TInput, TOutput> {
  name: PlannerStageName;
  version: string;
  buildInput(context: PlannerContext): Promise<TInput>;
  execute(input: TInput, runtime: StageRuntime): Promise<TOutput>;
  validate(output: unknown): TOutput;
  summarize(output: TOutput): StageSummary;
}
