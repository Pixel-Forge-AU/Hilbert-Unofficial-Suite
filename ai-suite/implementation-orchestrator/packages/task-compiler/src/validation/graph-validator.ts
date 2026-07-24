import type {
  CompilationManifest,
  ExecutableTask,
  ExecutionPhase,
  GraphFinding,
  TaskDependency,
  TaskGraphValidationResult,
} from "@implementation-orchestrator/contracts";
import { computeCoverage } from "../coverage.js";
import type { TaskCompilerConfig } from "../config.js";
import { findHardDependencyCycle } from "./cycle-detection.js";

export interface GraphValidationInput {
  manifest: CompilationManifest;
  tasks: ExecutableTask[];
  dependencies: TaskDependency[];
  phases: ExecutionPhase[];
  config: TaskCompilerConfig;
}

export function validateTaskGraph(input: GraphValidationInput): TaskGraphValidationResult {
  const { manifest, tasks, dependencies, phases, config } = input;
  const errors: GraphFinding[] = [];
  const warnings: GraphFinding[] = [];

  const taskIds = tasks.map((t) => t.id);
  const taskIdSet = new Set(taskIds);
  const phaseIdSet = new Set(phases.map((p) => p.id));

  const seenIds = new Set<string>();
  for (const id of taskIds) {
    if (seenIds.has(id)) {
      errors.push({ code: "duplicate_task_id", message: `Duplicate task id "${id}".`, taskId: id });
    }
    seenIds.add(id);
  }

  for (const dep of dependencies) {
    if (dep.fromTaskId === dep.toTaskId) {
      errors.push({
        code: "self_dependency",
        message: `Task "${dep.fromTaskId}" cannot depend on itself.`,
        taskId: dep.fromTaskId,
      });
    }
    if (!taskIdSet.has(dep.fromTaskId)) {
      errors.push({
        code: "missing_dependency_source",
        message: `Dependency references unknown source task "${dep.fromTaskId}".`,
        taskId: dep.fromTaskId,
      });
    }
    if (!taskIdSet.has(dep.toTaskId)) {
      errors.push({
        code: "missing_dependency_target",
        message: `Task "${dep.fromTaskId}" depends on unknown task "${dep.toTaskId}".`,
        taskId: dep.fromTaskId,
      });
    }
  }

  const cycle = findHardDependencyCycle(taskIds, dependencies);
  if (cycle) {
    errors.push({
      code: "hard_dependency_cycle",
      message: `Hard dependency cycle detected: ${cycle.join(" -> ")}.`,
    });
  }

  for (const task of tasks) {
    if (!phaseIdSet.has(task.phaseId)) {
      errors.push({
        code: "task_missing_phase",
        message: `Task "${task.id}" references unknown phase "${task.phaseId}".`,
        taskId: task.id,
      });
    }
    if (task.verification.checks.length === 0) {
      errors.push({
        code: "task_missing_verification",
        message: `Task "${task.id}" has no verification checks.`,
        taskId: task.id,
      });
    }
  }

  const hasSetupTask = tasks.some((t) => t.category === "dependency");
  if (!hasSetupTask) {
    errors.push({
      code: "missing_repository_setup",
      message: "No dependency-installation task was generated for this workflow.",
    });
  }

  const hasDatabaseTask = tasks.some((t) => t.category === "database");
  const hasMigrationTask = tasks.some((t) => t.category === "migration");
  if (hasDatabaseTask && !hasMigrationTask) {
    errors.push({
      code: "database_changes_without_migration",
      message: "A database-category task exists without a corresponding migration task.",
    });
  }

  const coverage = computeCoverage(manifest, tasks);
  for (const gap of coverage.unresolvedItems) {
    if (gap.kind === "essential_feature" || gap.kind === "acceptance_criterion") {
      errors.push({ code: `coverage_gap_${gap.kind}`, message: gap.reason, featureId: gap.id });
    } else {
      warnings.push({ code: `coverage_gap_${gap.kind}`, message: gap.reason, featureId: gap.id });
    }
  }

  const minimums = config.compilerCoverageMinimums;
  if (coverage.essentialFeaturesCovered < minimums.essentialFeatures) {
    errors.push({
      code: "essential_feature_coverage_below_minimum",
      message: `Essential feature coverage ${coverage.essentialFeaturesCovered} is below the required minimum ${minimums.essentialFeatures}.`,
    });
  }
  if (coverage.acceptanceCriteriaCovered < minimums.essentialAcceptanceCriteria) {
    errors.push({
      code: "acceptance_criteria_coverage_below_minimum",
      message: `Essential acceptance-criteria coverage ${coverage.acceptanceCriteriaCovered} is below the required minimum ${minimums.essentialAcceptanceCriteria}.`,
    });
  }
  if (coverage.testScenariosCovered < minimums.requiredTestScenarios) {
    errors.push({
      code: "test_scenario_coverage_below_minimum",
      message: `Required test-scenario coverage ${coverage.testScenariosCovered} is below the required minimum ${minimums.requiredTestScenarios}.`,
    });
  }
  if (coverage.highValueFeaturesCovered < minimums.highValueFeatures) {
    warnings.push({
      code: "high_value_feature_coverage_below_minimum",
      message: `High-value feature coverage ${coverage.highValueFeaturesCovered} is below the configured minimum ${minimums.highValueFeatures}.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    coverage,
  };
}
