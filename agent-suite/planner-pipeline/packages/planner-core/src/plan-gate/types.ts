import type {
  BuildManifest,
  PlanCritique,
  PlanGateFinding,
  PlanGateSeverity,
  PlannerStageName
} from "@planner/contracts";
import type { ReferenceIndex } from "./reference-index.js";
import type { UnresolvedDecisionClassification } from "./unresolved-decision-classifier.js";

export interface PlanGateRuleContext {
  manifest: BuildManifest;
  // Optional because early per-stage checks (see early-checks.ts) run before plan_critic or
  // specification_compiler's unresolvedDecisions exist - no rule that runs that early reads
  // either field, but the type has to permit omitting them to build that narrower context.
  critique?: PlanCritique;
  referenceIndex: ReferenceIndex;
  unresolvedDecisionClassifications: Map<string, UnresolvedDecisionClassification>;
}

export interface PlanGateRule {
  id: string;
  description: string;
  defaultSeverity: PlanGateSeverity;
  // The earliest stage whose output makes this rule's inputs fully available - see
  // early-checks.ts, which runs each rule as soon as its earliestStage completes instead of
  // waiting for the full manifest at the end of the pipeline. Deliberately independent of
  // createFinding's responsibleStage: a rule can become checkable at one stage (e.g.
  // specification_compiler, once implementationPlan exists) while the defect it finds is
  // actually the fault of an earlier stage (e.g. systems_architect) - only findings where the
  // two coincide are eligible for an immediate same-stage retry.
  earliestStage: PlannerStageName;
  evaluate(context: PlanGateRuleContext): PlanGateFinding[];
}

export function makeFindingId(ruleId: string, discriminator: string): string {
  return `${ruleId}:${discriminator}`;
}

export function createFinding(args: {
  ruleId: string;
  discriminator: string;
  severity: PlanGateSeverity;
  sectionPath: string;
  problem: string;
  evidence: string;
  requiredChange: string;
  responsibleStage: PlannerStageName;
  requiresAdjudication?: boolean;
}): PlanGateFinding {
  return {
    id: makeFindingId(args.ruleId, args.discriminator),
    ruleId: args.ruleId,
    severity: args.severity,
    sectionPath: args.sectionPath,
    problem: args.problem,
    evidence: args.evidence,
    requiredChange: args.requiredChange,
    responsibleStage: args.responsibleStage,
    requiresAdjudication: args.requiresAdjudication ?? false,
    adjudicationOutcome: null,
    adjudicationRationale: null
  };
}
