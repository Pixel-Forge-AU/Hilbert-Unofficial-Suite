export interface TaskCompilerConfig {
  maxAcceptanceCriteriaPerTask: number;
  compilerCoverageMinimums: {
    essentialFeatures: number;
    essentialAcceptanceCriteria: number;
    requiredTestScenarios: number;
    highValueFeatures: number;
  };
}

export const DEFAULT_TASK_COMPILER_CONFIG: TaskCompilerConfig = {
  maxAcceptanceCriteriaPerTask: 8,
  compilerCoverageMinimums: {
    essentialFeatures: 1.0,
    essentialAcceptanceCriteria: 1.0,
    requiredTestScenarios: 1.0,
    highValueFeatures: 0.95,
  },
};

export const COMPILER_VERSION = "1.0.0";
export const GRAPH_VERSION = "1.0.0";
