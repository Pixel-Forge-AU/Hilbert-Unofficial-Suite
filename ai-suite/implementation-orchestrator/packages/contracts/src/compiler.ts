import type { CompilationManifest } from "./compilation-manifest.js";
import type { RepositoryProfile } from "./repository.js";
import type { ExecutionPolicy } from "./policies.js";
import type { ExecutableTask, TaskDependency } from "./task.js";

export interface TaskCompilerInput {
  manifest: CompilationManifest;
  repository: RepositoryProfile;
  policy: ExecutionPolicy;
  compilerVersion: string;
  defaultBuilderProfile: string;
  workflowBranch: string;
}

export interface ExecutionPhase {
  id: string;
  name: string;
  order: number;
  taskIds: string[];
}

export interface CompilerWarning {
  code: string;
  message: string;
  taskId?: string;
  featureId?: string;
}

export interface CompilerCoverageGap {
  kind: "essential_feature" | "high_value_feature" | "acceptance_criterion" | "test_scenario";
  id: string;
  reason: string;
}

export interface CompilationCoverage {
  essentialFeaturesCovered: number;
  highValueFeaturesCovered: number;
  acceptanceCriteriaCovered: number;
  testScenariosCovered: number;
  unresolvedItems: CompilerCoverageGap[];
}

export interface CompiledTaskGraph {
  graphVersion: string;
  compilerVersion: string;
  tasks: ExecutableTask[];
  dependencies: TaskDependency[];
  phases: ExecutionPhase[];
  coverage: CompilationCoverage;
  warnings: CompilerWarning[];
}

export interface GraphFinding {
  code: string;
  message: string;
  taskId?: string;
  featureId?: string;
}

export interface TaskGraphValidationResult {
  valid: boolean;
  errors: GraphFinding[];
  warnings: GraphFinding[];
  coverage: CompilationCoverage;
}
