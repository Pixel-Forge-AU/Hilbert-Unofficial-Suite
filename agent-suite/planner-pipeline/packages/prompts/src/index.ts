import type { PlannerStageName, RevisionRequest } from "@planner/contracts";
import { EDGE_CASE_MINIMUMS, stageOutputSchemas, toPartialStageSchema } from "@planner/contracts";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

export interface PromptContext {
  plan: unknown;
  previousOutputs: Record<string, unknown>;
  revisionRequests?: RevisionRequest[];
  /**
   * This stage's own most recently produced output, if it has run before. When present
   * alongside a revision request targeting this stage, buildStagePrompt switches to patch
   * mode: the model is asked for only the top-level field(s) that need to change, which are
   * then merged onto this value - everything else is guaranteed untouched by construction,
   * rather than hoping a full regeneration happens to preserve it.
   */
  previousStageOutput?: unknown;
  /**
   * Every revision request ever raised against this stage across the whole plan (from any
   * prior cycle), oldest first - rendered as a "previously fixed, don't reintroduce"
   * reminder. Patch mode already guarantees a field this stage doesn't touch survives a
   * revision byte-for-byte; this covers the gap patch mode can't: a field that *does* get
   * touched again later, for an unrelated reason, silently regressing something already
   * fixed because nothing reminded the model it mattered.
   */
  resolvedIssues?: RevisionRequest[];
}

export interface StagePrompt {
  version: string;
  system: string;
  prompt: string;
  /** True if this prompt asks for a partial patch rather than a full stage output. */
  isPatch: boolean;
}

const VERSION = "2026-07-14.1";

const stageObjectives: Record<PlannerStageName, string> = {
  intent_interpreter:
    "Transform the raw brief into structured intent without choosing a solution prematurely.",
  concept_generator:
    "Generate at least five genuinely different product concepts across safe, premium, playful, ambitious, and strange directions.",
  creative_director:
    "Select and combine the strongest ideas into one decisive creative direction without averaging them into blandness.",
  feature_expander:
    "Recursively expand the selected product into hierarchical features with concrete flows, states, data, permissions, failures, accessibility, mobile behaviour, acceptance criteria, and tests.",
  ux_designer:
    "Define end-to-end journeys for important user types, including recovery paths and instrumentation.",
  art_director:
    "Create a concrete measurable visual, layout, interaction, motion, responsive, loading, empty, and error specification.",
  systems_architect:
    "Translate the product definition into implementable architecture, data models, APIs, jobs, security, operations, tests, and architecture decisions with rationale.",
  edge_case_hunter:
    "Attack the proposed product and architecture with behavioural, data, visual, mobile, accessibility, security, and operational edge cases.",
  scope_challenger:
    "Prioritise the plan without destroying ambition, preserving signature elements where feasible.",
  specification_compiler:
    "Compile accepted stage outputs into the canonical build manifest sections that require synthesis.",
  plan_critic:
    "Reject vague, generic, contradictory, incomplete, or unbuildable plans and return targeted change requests only.",
  plan_gate:
    "Deterministically verify the compiled manifest is referentially intact, dependency-cycle-free, and implementation-ready. (Not driven by buildStagePrompt — see @planner/planner-core's plan-gate module.)"
};

/**
 * Which prior stage outputs each stage sees as context - the canonical source of truth for
 * both prompt-building (below) and revision-cascade routing (@planner/planner-core's
 * revision-router), since a stage only needs to be regenerated on revision if something it
 * actually depends on changed.
 */
export const STAGE_CONTEXT_DEPENDENCIES: Record<PlannerStageName, string[]> = {
  intent_interpreter: [],
  concept_generator: ["intent_interpreter"],
  creative_director: ["intent_interpreter", "concept_generator"],
  feature_expander: ["intent_interpreter", "creative_director"],
  ux_designer: ["intent_interpreter", "creative_director", "feature_expander"],
  art_director: ["intent_interpreter", "creative_director", "feature_expander", "ux_designer"],
  systems_architect: ["intent_interpreter", "creative_director", "feature_expander", "ux_designer", "art_director"],
  edge_case_hunter: [
    "intent_interpreter",
    "creative_director",
    "feature_expander",
    "ux_designer",
    "art_director",
    "systems_architect"
  ],
  scope_challenger: ["creative_director", "feature_expander", "ux_designer", "systems_architect", "edge_case_hunter"],
  specification_compiler: [
    "intent_interpreter",
    "creative_director",
    "feature_expander",
    "ux_designer",
    "art_director",
    "systems_architect",
    "edge_case_hunter",
    "scope_challenger"
  ],
  plan_critic: [
    "final_manifest",
    "intent_interpreter",
    "creative_director",
    "feature_expander",
    "ux_designer",
    "art_director",
    "systems_architect",
    "edge_case_hunter",
    "scope_challenger",
    "specification_compiler"
  ],
  plan_gate: []
};

const stageRules: Partial<Record<PlannerStageName, string[]>> = {
  plan_critic: [
    "Assume the plan is incomplete until evidence proves otherwise.",
    "Do not praise the plan.",
    "Find exact evidence and exact required changes.",
    "Approve only when the output quality meets the configured gate, not because effort is visible."
  ],
  art_director: [
    "Avoid vague terms unless immediately followed by concrete measurable rules.",
    "Provide pixel, duration, density, breakpoint, contrast, and behaviour values wherever practical."
  ],
  // EDGE_CASE_MINIMUMS is enforced by a Zod .superRefine() on the full report (see stages.ts),
  // which is invisible in the JSON schema shown below - zod-to-json-schema can't serialize
  // imperative refinement logic, only declarative shape. Without spelling the minimums out
  // here in prose, the model has no way to learn they exist at all, and nothing in a schema
  // that only shows "findings: array of finding objects, min 1" stops it from treating one
  // satisfied category (typically "behaviour", the first and largest) as task-complete.
  edge_case_hunter: [
    "You MUST produce findings across EVERY ONE of the categories below, not just one or two - " +
      "stopping after satisfying only some categories is a failure, even if the total finding count looks large:",
    ...Object.entries(EDGE_CASE_MINIMUMS).map(([category, minimum]) => `- "${category}": at least ${minimum} findings`),
    "The JSON schema below only shows field shapes, not these per-category minimums - this list is the actual requirement.",
    "Treat missing recovery behaviour as a serious gap."
  ]
};

export function buildStagePrompt(stageName: PlannerStageName, context: PromptContext): StagePrompt {
  const revisionRequests = (context.revisionRequests ?? []).filter(
    (request) => request.responsibleStage === stageName
  );

  if (revisionRequests.length > 0 && context.previousStageOutput !== undefined && context.previousStageOutput !== null) {
    return buildPatchPrompt(stageName, context, revisionRequests);
  }

  const relevant = selectRelevantContext(stageName, context.previousOutputs);
  return {
    version: VERSION,
    isPatch: false,
    system: [
      "You are a specialist planning stage inside a multi-stage AI planner.",
      "You must work only on your stage objective.",
      "Return only valid JSON matching the requested schema.",
      "Be concrete, testable, traceable, and assumption-aware.",
      "Do not write production code.",
      "Do not include markdown fences or commentary."
    ].join("\n"),
    prompt: [
      `Stage: ${stageName}`,
      `Objective: ${stageObjectives[stageName]}`,
      "",
      ...buildRevisionSection(revisionRequests),
      ...buildResolvedIssuesSection(context.resolvedIssues, revisionRequests),
      "Global rules:",
      "- Label assumptions and distinguish them from facts.",
      "- Avoid unsupported claims and generic filler.",
      "- Define observable behaviour and testable requirements.",
      "- Preserve traceability to the original brief and constraints.",
      "- Distinguish mandatory work from optional novelty.",
      "- Return only the requested JSON structure.",
      "",
      "Stage-specific rules:",
      ...(stageRules[stageName] ?? []).map((rule) => `- ${rule}`),
      "",
      "Required output JSON schema (return an object matching this exactly - every property is required unless marked optional):",
      JSON.stringify(buildSchemaForPrompt(stageName), null, 2),
      "",
      "Project input:",
      JSON.stringify(context.plan, null, 2),
      "",
      "Relevant validated prior outputs:",
      JSON.stringify(relevant, null, 2),
      ...(revisionRequests.length > 0
        ? ["", "Reminder: this is a revision. Re-read the mandatory fixes above before you write anything."]
        : [])
    ].join("\n")
  };
}

/**
 * A stage that's being revised is normally regenerated in full, which is inherently
 * stochastic - fixing this cycle's flagged defect gives no guarantee the rest of the output
 * comes out the same as before, so unrelated content can silently drift or regress. Patch
 * mode instead asks the model for only the top-level field(s) that must change; the caller
 * merges those onto the existing output, so every field not named in the patch is guaranteed
 * byte-identical to what it was, not just "hopefully preserved".
 */
function buildPatchPrompt(
  stageName: PlannerStageName,
  context: PromptContext,
  revisionRequests: RevisionRequest[]
): StagePrompt {
  const relevant = selectRelevantContext(stageName, context.previousOutputs);
  return {
    version: VERSION,
    isPatch: true,
    system: [
      "You are a specialist planning stage inside a multi-stage AI planner.",
      "You are PATCHING an existing output, not writing a new one from scratch.",
      "Return a JSON object containing ONLY the top-level field(s) that need to change.",
      "Do not include any field whose value is not changing.",
      "Do not write production code.",
      "Do not include markdown fences or commentary."
    ].join("\n"),
    prompt: [
      `Stage: ${stageName}`,
      `Objective: ${stageObjectives[stageName]}`,
      "",
      ...buildRevisionSection(revisionRequests),
      ...buildResolvedIssuesSection(context.resolvedIssues, revisionRequests),
      "PATCH MODE: the current value of this stage's output is given below, already valid and",
      "already reviewed - everything in it stays exactly as-is except what you change here.",
      "- Return ONLY the top-level field(s) that must change to fix the defect(s) above.",
      "- Omit every field that doesn't need to change - it will be kept exactly as shown below.",
      "- A field you DO include must be its COMPLETE corrected value (e.g. the full array with",
      "  every item, not just the changed item), since it fully replaces the current value.",
      "",
      "Current value of this stage's output (do not repeat unchanged parts of this back):",
      JSON.stringify(context.previousStageOutput, null, 2),
      "",
      "JSON schema for the field(s) you choose to include (only include fields you're changing):",
      JSON.stringify(buildSchemaForPrompt(stageName, buildPartialSchema(stageName)), null, 2),
      "",
      "Relevant validated prior outputs:",
      JSON.stringify(relevant, null, 2)
    ].join("\n")
  };
}

function buildPartialSchema(stageName: PlannerStageName): ZodTypeAny {
  return toPartialStageSchema(stageOutputSchemas[stageName] as ZodTypeAny);
}

/**
 * Revision requests are the single highest-leverage instruction in a revision prompt - they
 * name an exact, previously-confirmed defect. Rendering them as a JSON blob at the very tail
 * of a prompt that can run into the tens of thousands of tokens buries the one instruction
 * that most needs to be followed under primacy/recency bias, and JSON is read less carefully
 * than an imperative sentence. Putting them first, as plain mandatory directives, is a direct
 * fix for a real observed failure mode: the same explicit fix requested and ignored across
 * multiple consecutive revision cycles.
 */
function buildRevisionSection(revisionRequests: RevisionRequest[]): string[] {
  if (revisionRequests.length === 0) return [];
  const lines = [
    "THIS IS A REVISION. The plan was rejected specifically because of the defect(s) below.",
    "Every one of these MUST be fixed in this output - fixing them takes priority over everything else in this stage's objective.",
    "A defect restated here means a previous attempt did not actually fix it - do not repeat that output.",
    ""
  ];
  revisionRequests.forEach((request, index) => {
    lines.push(`${index + 1}. [${request.severity}] ${request.problem}`);
    lines.push(`   Required fix: ${request.requiredChange}`);
    lines.push(`   Location: ${request.section}`);
  });
  lines.push("");
  return lines;
}

/**
 * Excludes anything already listed in the CURRENT cycle's active revisionRequests (those are
 * rendered separately, right above, by buildRevisionSection with higher urgency) - this
 * section is specifically for *older* issues that were fixed in a previous cycle and must
 * not quietly come back now, whether or not this attempt is itself a revision.
 */
function buildResolvedIssuesSection(
  resolvedIssues: RevisionRequest[] | undefined,
  currentRevisionRequests: RevisionRequest[]
): string[] {
  const currentProblems = new Set(currentRevisionRequests.map((request) => request.problem));
  const history = (resolvedIssues ?? []).filter((issue) => !currentProblems.has(issue.problem));
  if (history.length === 0) return [];
  const lines = [
    "PREVIOUSLY FIXED - DO NOT REINTRODUCE. Earlier revision cycles already fixed the issues below.",
    "Verify your output here still honours every fix; silently regressing one of these while addressing something else is a failure just like never fixing it.",
    ""
  ];
  history.forEach((issue, index) => {
    lines.push(`${index + 1}. ${issue.problem}`);
    lines.push(`   Fix that was applied: ${issue.requiredChange}`);
  });
  lines.push("");
  return lines;
}

function buildSchemaForPrompt(stageName: PlannerStageName, schemaOverride?: ZodTypeAny): unknown {
  const jsonSchema = zodToJsonSchema(schemaOverride ?? stageOutputSchemas[stageName], {
    target: "openApi3",
    $refStrategy: "none"
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function selectRelevantContext(
  stageName: PlannerStageName,
  outputs: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    STAGE_CONTEXT_DEPENDENCIES[stageName]
      .filter((key) => key in outputs)
      .map((key) => [key, outputs[key]])
  );
}
