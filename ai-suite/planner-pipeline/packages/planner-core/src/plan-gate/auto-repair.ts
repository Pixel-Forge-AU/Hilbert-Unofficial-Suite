import type { BuildManifest, PlanGateFinding } from "@planner/contracts";

export interface AutoRepairResult {
  manifest: BuildManifest;
  repairedFindingIds: string[];
}

/**
 * Most reference-integrity findings are mechanical (a dangling id that should be removed,
 * or a required id that should point at a real, already-known fallback) rather than a sign
 * the stage needs to re-think anything. Repairing them deterministically, before spending an
 * expensive full revision cycle, fixes the common case where a large model invents a
 * plausible-looking id instead of copying the real one from its own prior output.
 *
 * Only individually-safe, array-shrinking-or-reassigning edits are made here — anything that
 * would violate a schema's min-length constraint, or that reflects a genuine structural/design
 * problem (cycles, missing sections, unresolved decisions), is left for the normal revision path.
 */
export function attemptAutoRepair(manifest: BuildManifest, findings: PlanGateFinding[]): AutoRepairResult {
  const fallbackPhaseId = manifest.implementationPlan.phases[0]?.id;
  const errorFindings = findings.filter((f) => f.severity === "error");

  // Pass 1: edits that can only ever remove a dangling reference, never a feature's only
  // link to a phase or a scope classification — always safe to apply.
  const safeFindings = errorFindings.filter((f) => !isRiskyFinding(f));
  const afterSafe = applyRepairs(manifest, safeFindings, fallbackPhaseId);

  // Pass 2: edits that could orphan a real feature from phase assignment or scope
  // classification if the dangling id was actually a near-miss typo rather than a fully
  // invented one. Only keep them if feature coverage provably doesn't shrink.
  // Coverage is intersected against real feature ids: removing the flagged dangling id
  // itself (which by definition never matched a real feature) must not register as a
  // "loss" - only a real feature actually dropping out of coverage counts.
  const realFeatureIds = new Set(manifest.features.map((f) => f.id));
  const riskyFindings = errorFindings.filter(isRiskyFinding);
  const beforeRiskyPhaseCoverage = featurePhaseCoverage(afterSafe.manifest, realFeatureIds);
  const beforeRiskyClassificationCoverage = featureClassificationCoverage(afterSafe.manifest, realFeatureIds);
  const afterRisky = applyRepairs(afterSafe.manifest, riskyFindings, fallbackPhaseId);
  const afterRiskyPhaseCoverage = featurePhaseCoverage(afterRisky.manifest, realFeatureIds);
  const afterRiskyClassificationCoverage = featureClassificationCoverage(afterRisky.manifest, realFeatureIds);

  const coverageShrank =
    !isSuperset(afterRiskyPhaseCoverage, beforeRiskyPhaseCoverage) ||
    !isSuperset(afterRiskyClassificationCoverage, beforeRiskyClassificationCoverage);

  if (coverageShrank) {
    // A risky repair would have dropped a feature's only phase assignment or scope
    // classification - safer to leave those specific findings unrepaired than silently
    // shrink what actually gets built.
    return { manifest: afterSafe.manifest, repairedFindingIds: afterSafe.repairedFindingIds };
  }

  return {
    manifest: afterRisky.manifest,
    repairedFindingIds: [...afterSafe.repairedFindingIds, ...afterRisky.repairedFindingIds]
  };
}

function isRiskyFinding(finding: PlanGateFinding): boolean {
  if (finding.ruleId === "ref-scope-classification-ids") return true;
  if (finding.ruleId === "ref-implementation-plan-ids") {
    const discriminator = finding.id.slice(finding.ruleId.length + 1);
    return discriminator.startsWith("phase:");
  }
  return false;
}

function featurePhaseCoverage(manifest: BuildManifest, realFeatureIds: Set<string>): Set<string> {
  const covered = manifest.implementationPlan.phases.flatMap((phase) => phase.includedFeatureIds);
  return new Set(covered.filter((id) => realFeatureIds.has(id)));
}

function featureClassificationCoverage(manifest: BuildManifest, realFeatureIds: Set<string>): Set<string> {
  const covered = manifest.scope.classifications.map((classification) => classification.itemId);
  return new Set(covered.filter((id) => realFeatureIds.has(id)));
}

function isSuperset(after: Set<string>, before: Set<string>): boolean {
  for (const value of before) {
    if (!after.has(value)) return false;
  }
  return true;
}

function applyRepairs(
  manifest: BuildManifest,
  findings: PlanGateFinding[],
  fallbackPhaseId: string | undefined
): AutoRepairResult {
  const repaired: BuildManifest = structuredClone(manifest);
  const repairedFindingIds: string[] = [];

  for (const finding of findings) {
    const discriminator = finding.id.slice(finding.ruleId.length + 1);
    const parts = discriminator.split(":");

    switch (finding.ruleId) {
      case "ref-traceability-entry-ids": {
        const [indexStr, key, badId] = parts;
        if (key === undefined || badId === undefined) break;
        const entry = repaired.traceability.entries[Number(indexStr)] as unknown as Record<string, unknown>;
        const list = entry?.[key];
        if (Array.isArray(list)) {
          const before = list.length;
          entry[key] = list.filter((value) => value !== badId);
          if ((entry[key] as unknown[]).length < before) repairedFindingIds.push(finding.id);
        }
        break;
      }
      case "ref-feature-dependency-ids": {
        const [featureId, badId] = parts;
        const feature = repaired.features.find((f) => f.id === featureId);
        if (feature) {
          const before = feature.dependencies.length;
          feature.dependencies = feature.dependencies.filter((d) => d !== badId);
          if (feature.dependencies.length < before) repairedFindingIds.push(finding.id);
        }
        break;
      }
      case "ref-journey-step-feature-ids": {
        const [journeyId, stepStr, badId] = parts;
        const journey = repaired.journeys.find((j) => j.id === journeyId);
        const step = journey?.steps.find((s) => String(s.step) === stepStr);
        if (step) {
          const before = step.featureIds.length;
          step.featureIds = step.featureIds.filter((f) => f !== badId);
          if (step.featureIds.length < before) repairedFindingIds.push(finding.id);
        }
        break;
      }
      case "ref-implementation-plan-ids": {
        if (parts[0] === "phase") {
          const [, phaseId, badId] = parts;
          const phase = repaired.implementationPlan.phases.find((p) => p.id === phaseId);
          if (phase) {
            const before = phase.includedFeatureIds.length;
            phase.includedFeatureIds = phase.includedFeatureIds.filter((f) => f !== badId);
            if (phase.includedFeatureIds.length < before) repairedFindingIds.push(finding.id);
          }
        } else if (parts[0] === "dbChange" && fallbackPhaseId) {
          const [, changeId] = parts;
          const change = repaired.implementationPlan.databaseChanges.find((c) => c.id === changeId);
          if (change) {
            change.phaseId = fallbackPhaseId;
            repairedFindingIds.push(finding.id);
          }
        } else if (parts[0] === "checkpoint" && fallbackPhaseId) {
          const [, checkpointId] = parts;
          const checkpoint = repaired.implementationPlan.releaseCheckpoints.find((c) => c.id === checkpointId);
          if (checkpoint) {
            checkpoint.afterPhaseId = fallbackPhaseId;
            repairedFindingIds.push(finding.id);
          }
        }
        break;
      }
      case "ref-scope-classification-ids": {
        const badId = parts[0];
        const before = repaired.scope.classifications.length;
        if (before > 1) {
          repaired.scope.classifications = repaired.scope.classifications.filter((c) => c.itemId !== badId);
          if (repaired.scope.classifications.length < before) repairedFindingIds.push(finding.id);
        }
        break;
      }
      default:
        break;
    }
  }

  return { manifest: repaired, repairedFindingIds };
}
