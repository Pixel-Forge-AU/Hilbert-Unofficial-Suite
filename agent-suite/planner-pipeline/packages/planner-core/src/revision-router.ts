import type { PlanCritique, PlanGateFinding, PlannerStageName, RevisionRequest } from "@planner/contracts";
import { STAGE_CONTEXT_DEPENDENCIES } from "@planner/prompts";
import { STAGE_ORDER } from "./registry.js";

/**
 * A stage genuinely needs to be regenerated on revision only if it was itself named
 * responsible for a defect, or if it depends (directly or transitively, per the same
 * dependency table the prompts are built from) on a stage that did. This replaces a blunt
 * "earliest responsible stage through the end of the pipeline" cascade, which forced full
 * regeneration of every downstream stage even when most of them had no flagged issues at
 * all - wasting LLM calls and, worse, introducing fresh unrelated regressions into content
 * that was already fine.
 *
 * plan_gate is a special case: it validates the compiled manifest deterministically and
 * isn't part of the prompt-context dependency table (it has no prompt), but it always needs
 * to re-run whenever specification_compiler or plan_critic does.
 */
export function computeDirtyStages(responsibleStages: PlannerStageName[]): PlannerStageName[] {
  const dirty = new Set(responsibleStages);
  for (const stage of STAGE_ORDER) {
    if (dirty.has(stage)) continue;
    const dependencies = STAGE_CONTEXT_DEPENDENCIES[stage] ?? [];
    if (dependencies.some((dependency) => dirty.has(dependency as PlannerStageName))) {
      dirty.add(stage);
    }
  }
  if (dirty.has("specification_compiler") || dirty.has("plan_critic")) {
    dirty.add("plan_critic");
    dirty.add("plan_gate");
  }
  return STAGE_ORDER.filter((stage) => dirty.has(stage));
}

function buildRoute(requests: RevisionRequest[]): {
  earliestStage: PlannerStageName;
  stagesToRerun: PlannerStageName[];
  requests: RevisionRequest[];
} {
  if (requests.length === 0) {
    return {
      earliestStage: "specification_compiler",
      stagesToRerun: ["specification_compiler", "plan_critic", "plan_gate"],
      requests
    };
  }
  // Minor findings never block the quality gate on their own, so they shouldn't have the
  // power to force a stage's regeneration either - but if a stage is already dirty for a
  // real (blocking/major) reason, its minor requests still ride along in the prompt.
  const forcingStages = requests
    .filter((request) => request.severity !== "minor")
    .map((request) => request.responsibleStage);
  const stagesToRerun = computeDirtyStages(
    forcingStages.length > 0 ? forcingStages : requests.map((request) => request.responsibleStage)
  );
  const earliestStage = stagesToRerun[0] ?? "specification_compiler";
  return { earliestStage, stagesToRerun, requests };
}

export function routeRevisions(critique: PlanCritique): {
  earliestStage: PlannerStageName;
  stagesToRerun: PlannerStageName[];
  requests: RevisionRequest[];
} {
  return buildRoute(critique.revisionRequests);
}

export function routePlanGateRevisions(findings: PlanGateFinding[]): {
  earliestStage: PlannerStageName;
  stagesToRerun: PlannerStageName[];
  requests: RevisionRequest[];
} {
  const requests: RevisionRequest[] = findings.map((finding) => ({
    section: finding.sectionPath,
    problem: finding.problem,
    requiredChange: finding.requiredChange,
    responsibleStage: finding.responsibleStage,
    severity: "blocking"
  }));
  return buildRoute(requests);
}
