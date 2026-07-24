import type { PlanGateFinding } from "@planner/contracts";
import type { PlanGateReferenceType } from "../reference-index.js";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

type TraceabilityIdListKey =
  | "featureIds"
  | "journeyIds"
  | "architectureIds"
  | "acceptanceCriteriaIds"
  | "testScenarioIds";

const refFeatureDependencyIds: PlanGateRule = {
  id: "ref-feature-dependency-ids",
  description: "Every feature dependency must reference a real feature id.",
  defaultSeverity: "error",
  earliestStage: "feature_expander",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const feature of manifest.features) {
      for (const dependencyId of feature.dependencies) {
        if (referenceIndex.has("feature", dependencyId)) continue;
        findings.push(
          createFinding({
            ruleId: refFeatureDependencyIds.id,
            discriminator: `${feature.id}:${dependencyId}`,
            severity: "error",
            sectionPath: `features.${feature.id}.dependencies`,
            problem: `Feature "${feature.id}" depends on unknown feature "${dependencyId}".`,
            evidence: `dependencies contains "${dependencyId}", which does not match any features[].id.`,
            requiredChange: `Remove "${dependencyId}" from features.${feature.id}.dependencies or add the missing feature.`,
            responsibleStage: "feature_expander"
          })
        );
      }
    }
    return findings;
  }
};

const refJourneyStepFeatureIds: PlanGateRule = {
  id: "ref-journey-step-feature-ids",
  description: "Every journey step feature reference must resolve to a real feature.",
  defaultSeverity: "error",
  earliestStage: "ux_designer",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const journey of manifest.journeys) {
      for (const step of journey.steps) {
        for (const featureId of step.featureIds) {
          if (referenceIndex.has("feature", featureId)) continue;
          findings.push(
            createFinding({
              ruleId: refJourneyStepFeatureIds.id,
              discriminator: `${journey.id}:${step.step}:${featureId}`,
              severity: "error",
              sectionPath: `journeys.${journey.id}.steps[${step.step}].featureIds`,
              problem: `Journey "${journey.id}" step ${step.step} references unknown feature "${featureId}".`,
              evidence: `featureIds contains "${featureId}", which does not match any features[].id.`,
              requiredChange: `Remove "${featureId}" from the step or add the missing feature.`,
              responsibleStage: "ux_designer"
            })
          );
        }
      }
    }
    return findings;
  }
};

const TRACEABILITY_BUCKETS: { key: TraceabilityIdListKey; type: PlanGateReferenceType }[] = [
  { key: "featureIds", type: "feature" },
  { key: "journeyIds", type: "journey" },
  { key: "architectureIds", type: "architectureDecision" },
  { key: "acceptanceCriteriaIds", type: "acceptanceCriterion" },
  { key: "testScenarioIds", type: "testScenario" }
];

const refTraceabilityEntryIds: PlanGateRule = {
  id: "ref-traceability-entry-ids",
  description: "Every id referenced by a traceability entry must exist elsewhere in the manifest.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    manifest.traceability.entries.forEach((entry, index) => {
      for (const bucket of TRACEABILITY_BUCKETS) {
        for (const id of entry[bucket.key]) {
          if (referenceIndex.has(bucket.type, id)) continue;
          findings.push(
            createFinding({
              ruleId: refTraceabilityEntryIds.id,
              discriminator: `${index}:${bucket.key}:${id}`,
              severity: "error",
              sectionPath: `traceability.entries[${index}].${bucket.key}`,
              problem: `Traceability entry "${entry.sourceRequirement}" references unknown ${bucket.type} "${id}".`,
              evidence: `${bucket.key} contains "${id}", which does not resolve.`,
              requiredChange: `Remove "${id}" from traceability.entries[${index}].${bucket.key} or add the missing item.`,
              responsibleStage: "specification_compiler"
            })
          );
        }
      }
    });
    return findings;
  }
};

const refImplementationPlanIds: PlanGateRule = {
  id: "ref-implementation-plan-ids",
  description: "Implementation plan ids (phase feature assignments, database change phases, release checkpoints) must resolve.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const phase of manifest.implementationPlan.phases) {
      for (const featureId of phase.includedFeatureIds) {
        if (referenceIndex.has("feature", featureId)) continue;
        findings.push(
          createFinding({
            ruleId: refImplementationPlanIds.id,
            discriminator: `phase:${phase.id}:${featureId}`,
            severity: "error",
            sectionPath: `implementationPlan.phases.${phase.id}.includedFeatureIds`,
            problem: `Phase "${phase.id}" includes unknown feature "${featureId}".`,
            evidence: `includedFeatureIds contains "${featureId}", which does not match any features[].id.`,
            requiredChange: `Remove "${featureId}" from phase ${phase.id} or add the missing feature.`,
            responsibleStage: "specification_compiler"
          })
        );
      }
    }
    for (const change of manifest.implementationPlan.databaseChanges) {
      if (referenceIndex.has("phase", change.phaseId)) continue;
      findings.push(
        createFinding({
          ruleId: refImplementationPlanIds.id,
          discriminator: `dbChange:${change.id}`,
          severity: "error",
          sectionPath: `implementationPlan.databaseChanges.${change.id}.phaseId`,
          problem: `Database change "${change.id}" references unknown phase "${change.phaseId}".`,
          evidence: `phaseId "${change.phaseId}" does not match any implementationPlan.phases[].id.`,
          requiredChange: `Fix phaseId on database change "${change.id}" to reference a real phase.`,
          responsibleStage: "specification_compiler"
        })
      );
    }
    for (const checkpoint of manifest.implementationPlan.releaseCheckpoints) {
      if (referenceIndex.has("phase", checkpoint.afterPhaseId)) continue;
      findings.push(
        createFinding({
          ruleId: refImplementationPlanIds.id,
          discriminator: `checkpoint:${checkpoint.id}`,
          severity: "error",
          sectionPath: `implementationPlan.releaseCheckpoints.${checkpoint.id}.afterPhaseId`,
          problem: `Release checkpoint "${checkpoint.id}" references unknown phase "${checkpoint.afterPhaseId}".`,
          evidence: `afterPhaseId "${checkpoint.afterPhaseId}" does not match any implementationPlan.phases[].id.`,
          requiredChange: `Fix afterPhaseId on release checkpoint "${checkpoint.id}" to reference a real phase.`,
          responsibleStage: "specification_compiler"
        })
      );
    }
    return findings;
  }
};

const refDependencyGraphLabels: PlanGateRule = {
  id: "ref-dependency-graph-labels",
  description: "Dependency graph edge labels should match a known module, workstream, phase, or feature.",
  defaultSeverity: "warning",
  earliestStage: "specification_compiler",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    manifest.implementationPlan.dependencyGraph.forEach((edge, index) => {
      for (const label of [edge.from, edge.to]) {
        if (referenceIndex.has("dependencyGraphLabel", label)) continue;
        findings.push(
          createFinding({
            ruleId: refDependencyGraphLabels.id,
            discriminator: `${index}:${label}`,
            severity: "warning",
            sectionPath: `implementationPlan.dependencyGraph[${index}]`,
            problem: `Dependency graph edge label "${label}" does not match any known module, workstream, phase, or feature.`,
            evidence: `Edge {from: "${edge.from}", to: "${edge.to}"} references "${label}".`,
            requiredChange: `Confirm "${label}" is intentional free text, or align it with an existing module/workstream/phase/feature name.`,
            responsibleStage: "specification_compiler"
          })
        );
      }
    });
    return findings;
  }
};

const refScopeClassificationIds: PlanGateRule = {
  id: "ref-scope-classification-ids",
  description: "Scope classification items must reference a real feature or signature feature.",
  defaultSeverity: "error",
  earliestStage: "scope_challenger",
  evaluate({ manifest, referenceIndex }: PlanGateRuleContext): PlanGateFinding[] {
    const findings: PlanGateFinding[] = [];
    for (const classification of manifest.scope.classifications) {
      if (referenceIndex.has("scopeItem", classification.itemId)) continue;
      findings.push(
        createFinding({
          ruleId: refScopeClassificationIds.id,
          discriminator: classification.itemId,
          severity: "error",
          sectionPath: `scope.classifications.${classification.itemId}`,
          problem: `Scope classification "${classification.itemName}" references unknown item "${classification.itemId}".`,
          evidence: `itemId "${classification.itemId}" does not match any features[].id or productDirection.signatureFeatures[].id.`,
          requiredChange: `Fix itemId on scope classification "${classification.itemName}" to reference a real feature or signature feature.`,
          responsibleStage: "scope_challenger"
        })
      );
    }
    return findings;
  }
};

export const referenceIntegrityRules: PlanGateRule[] = [
  refFeatureDependencyIds,
  refJourneyStepFeatureIds,
  refTraceabilityEntryIds,
  refImplementationPlanIds,
  refDependencyGraphLabels,
  refScopeClassificationIds
];
