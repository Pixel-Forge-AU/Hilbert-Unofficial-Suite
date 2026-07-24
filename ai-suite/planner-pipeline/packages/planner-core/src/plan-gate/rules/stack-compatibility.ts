import type { PlanGateFinding } from "@planner/contracts";
import { createFinding, type PlanGateRule, type PlanGateRuleContext } from "../types.js";

const stackMigrationStrategyForDbChanges: PlanGateRule = {
  id: "stack-migration-strategy-for-db-changes",
  description: "If database changes are planned, a migration strategy must be declared.",
  defaultSeverity: "warning",
  earliestStage: "specification_compiler",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    if (manifest.implementationPlan.databaseChanges.length === 0) return [];
    if (manifest.architecture.migrationStrategy.steps.length > 0) return [];
    return [
      createFinding({
        ruleId: stackMigrationStrategyForDbChanges.id,
        discriminator: "missing",
        severity: "warning",
        sectionPath: "architecture.migrationStrategy",
        problem: "Database changes are planned but architecture.migrationStrategy.steps is empty.",
        evidence: `implementationPlan.databaseChanges has ${manifest.implementationPlan.databaseChanges.length} entrie(s); migrationStrategy.steps has 0.`,
        requiredChange: "Declare concrete migration steps in architecture.migrationStrategy.",
        responsibleStage: "systems_architect"
      })
    ];
  }
};

const stackRollbackStrategyForIrreversibleChanges: PlanGateRule = {
  id: "stack-rollback-strategy-for-irreversible-changes",
  description: "Any irreversible database change requires a declared rollback strategy.",
  defaultSeverity: "error",
  earliestStage: "specification_compiler",
  evaluate({ manifest }: PlanGateRuleContext): PlanGateFinding[] {
    const irreversible = manifest.implementationPlan.databaseChanges.filter((change) => !change.reversible);
    if (irreversible.length === 0) return [];
    if (manifest.architecture.rollbackStrategy.steps.length > 0) return [];
    return [
      createFinding({
        ruleId: stackRollbackStrategyForIrreversibleChanges.id,
        discriminator: "missing",
        severity: "error",
        sectionPath: "architecture.rollbackStrategy",
        problem: `${irreversible.length} irreversible database change(s) are planned but architecture.rollbackStrategy.steps is empty.`,
        evidence: `Irreversible change ids: ${irreversible.map((change) => change.id).join(", ")}.`,
        requiredChange: "Declare concrete rollback steps in architecture.rollbackStrategy before implementation begins.",
        responsibleStage: "systems_architect"
      })
    ];
  }
};

export const stackCompatibilityRules: PlanGateRule[] = [
  stackMigrationStrategyForDbChanges,
  stackRollbackStrategyForIrreversibleChanges
];
