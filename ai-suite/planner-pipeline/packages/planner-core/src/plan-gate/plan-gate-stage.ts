import {
  planGateAdjudicationBatchSchema,
  planGateResultSchema,
  type BuildManifest,
  type PlanCritique,
  type PlanGateResult,
  type StageSummary
} from "@planner/contracts";
import { adjudicatorModelProfile } from "@planner/llm";
import type { PlannerContext, PlannerStage, StageRuntime } from "../stage.js";
import { applyAdjudicationResults, buildAdjudicationPrompt } from "./adjudicator.js";
import { evaluatePlanGate } from "./evaluate.js";
import { buildPlanGateResult } from "./result-builder.js";

export interface PlanGateStageInput {
  manifest: BuildManifest;
  critique: PlanCritique;
}

export class PlanGateStage implements PlannerStage<PlanGateStageInput, PlanGateResult> {
  readonly name = "plan_gate" as const;
  readonly version = "1.0.0";

  async buildInput(context: PlannerContext): Promise<PlanGateStageInput> {
    const manifest = context.previousOutputs.final_manifest as BuildManifest | undefined;
    const critique = context.previousOutputs.plan_critic as PlanCritique | undefined;
    if (!manifest) throw new Error("plan_gate stage requires a compiled manifest (final_manifest) in previousOutputs.");
    if (!critique) throw new Error("plan_gate stage requires plan_critic output in previousOutputs.");
    return { manifest, critique };
  }

  async execute(input: PlanGateStageInput, runtime: StageRuntime): Promise<PlanGateResult> {
    const { findings, coverage } = evaluatePlanGate(input.manifest, input.critique);
    const ambiguous = findings.filter((finding) => finding.requiresAdjudication);

    if (ambiguous.length === 0) {
      return buildPlanGateResult(findings, coverage, false);
    }

    const { system, prompt } = buildAdjudicationPrompt(findings, input.manifest);
    const response = await runtime.model.generateStructured({
      profile: adjudicatorModelProfile(),
      system,
      prompt,
      schema: planGateAdjudicationBatchSchema,
      schemaName: "plan_gate_adjudication",
      abortSignal: runtime.abortSignal
    });
    const adjudicatedFindings = applyAdjudicationResults(findings, response.value.adjudications);
    return buildPlanGateResult(adjudicatedFindings, coverage, true);
  }

  validate(output: unknown): PlanGateResult {
    return planGateResultSchema.parse(output);
  }

  summarize(output: PlanGateResult): StageSummary {
    return {
      stage: "plan_gate",
      headline: `plan_gate decision: ${output.decision} (${output.errorCount} error, ${output.warningCount} warning, ${output.noticeCount} notice)`,
      keyPoints: output.findings.slice(0, 5).map((finding) => finding.problem),
      itemCounts: {
        errorCount: output.errorCount,
        warningCount: output.warningCount,
        noticeCount: output.noticeCount,
        findings: output.findings.length
      }
    };
  }
}
