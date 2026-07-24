import {
  PLANNER_STAGE_NAMES,
  type PlannerStageName,
  type StageSummary,
  stageOutputSchemas,
  toPartialStageSchema
} from "@planner/contracts";
import type { z } from "zod";
import { buildStagePrompt, type PromptContext } from "@planner/prompts";
import { defaultModelProfile } from "@planner/llm";
import { PlanGateStage } from "./plan-gate/plan-gate-stage.js";
import type { PlannerContext, PlannerStage, StageRuntime } from "./stage.js";

type StageOutput = unknown;

class LlmPlannerStage implements PlannerStage<PromptContext, StageOutput> {
  constructor(readonly name: PlannerStageName, readonly version: string) {}

  async buildInput(context: PlannerContext): Promise<PromptContext> {
    return {
      plan: context.plan,
      previousOutputs: context.previousOutputs,
      revisionRequests: context.revisionRequests as never[],
      previousStageOutput: context.previousStageOutput,
      resolvedIssues: context.resolvedIssues as never[]
    };
  }

  async execute(input: PromptContext, runtime: StageRuntime): Promise<StageOutput> {
    const prompt = buildStagePrompt(this.name, input);
    const profile = defaultModelProfile(this.name);
    const fullSchema = stageOutputSchemas[this.name] as z.ZodTypeAny;

    if (prompt.isPatch) {
      try {
        // Only the field(s) the model chooses to include are generated/validated here - the
        // partial schema is deliberately more permissive than the full one. Everything else
        // is carried over unchanged from the previous output, then the merged result is
        // re-validated against the full schema before being accepted as this stage's output.
        const partialSchema = toPartialStageSchema(stageOutputSchemas[this.name] as z.ZodTypeAny);
        const response = await runtime.model.generateStructured({
          profile,
          system: prompt.system,
          prompt: prompt.prompt,
          schema: partialSchema,
          schemaName: `${this.name}_patch`,
          abortSignal: runtime.abortSignal
        });
        const previous = input.previousStageOutput as Record<string, unknown>;
        const merged = { ...previous, ...(response.value as Record<string, unknown>) };
        return fullSchema.parse(merged);
      } catch (error) {
        // A model can fail to produce a valid patch in two ways: it never satisfies the
        // partial schema even across the repair budget (e.g. it keeps returning array items
        // with only the changed keys instead of the complete item), or its patch merges onto
        // the previous output into something that fails the full schema. Patch mode is meant
        // to be a strict improvement over full regeneration, not a new way for a stage to
        // fail outright - so either failure falls back to a full regeneration instead of
        // taking down the whole stage (and with it, the plan).
        runtime.logger.warn(
          { err: error },
          `Patch generation failed for ${this.name}, falling back to full regeneration.`
        );
        const fullPrompt = buildStagePrompt(this.name, { ...input, previousStageOutput: undefined });
        const response = await runtime.model.generateStructured({
          profile,
          system: fullPrompt.system,
          prompt: fullPrompt.prompt,
          schema: fullSchema,
          schemaName: this.name,
          abortSignal: runtime.abortSignal
        });
        return response.value;
      }
    }

    const response = await runtime.model.generateStructured({
      profile,
      system: prompt.system,
      prompt: prompt.prompt,
      schema: fullSchema,
      schemaName: this.name,
      abortSignal: runtime.abortSignal
    });
    return response.value;
  }

  validate(output: unknown): StageOutput {
    return (stageOutputSchemas[this.name] as z.ZodTypeAny).parse(output);
  }

  summarize(output: StageOutput): StageSummary {
    const object = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const itemCounts = Object.fromEntries(
      Object.entries(object)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as unknown[]).length])
    );
    return {
      stage: this.name,
      headline: `${this.name} completed with validated structured output.`,
      keyPoints: Object.keys(itemCounts).slice(0, 5),
      itemCounts
    };
  }
}

export const STAGE_ORDER = [...PLANNER_STAGE_NAMES] as PlannerStageName[];

export function createStageRegistry(): Map<PlannerStageName, PlannerStage<unknown, unknown>> {
  return new Map(
    STAGE_ORDER.map((name) => [
      name,
      name === "plan_gate" ? new PlanGateStage() : new LlmPlannerStage(name, "1.0.0")
    ])
  );
}

export function stageIndex(stageName: PlannerStageName): number {
  return STAGE_ORDER.indexOf(stageName);
}
