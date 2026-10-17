import { z } from "zod";

export const TaskExecutionPolicySchema = z.object({
  maxBuilderAttempts: z.number().int().positive(),
  maxRemediationCycles: z.number().int().nonnegative(),
  timeoutSeconds: z.number().int().positive(),
  heartbeatIntervalSeconds: z.number().int().positive(),
  leaseDurationSeconds: z.number().int().positive(),
  allowNetworkAccess: z.boolean(),
  allowDependencyChanges: z.boolean(),
  allowSchemaChanges: z.boolean(),
  requireCommit: z.boolean(),
});
export type TaskExecutionPolicy = z.infer<typeof TaskExecutionPolicySchema>;

export const ExecutionPolicySchema = z.object({
  id: z.string().min(1),
  maxConcurrentTasks: z.number().int().positive(),
  maxConcurrentBuilders: z.number().int().positive(),
  requireCleanBaseBranch: z.boolean(),
  requireWorkflowBranch: z.boolean(),
  requireTaskCommits: z.boolean(),
  allowParallelTasks: z.boolean(),
  allowDestructiveMigrations: z.boolean(),
  allowDependencyMajorUpgrades: z.boolean(),
  allowPaidExternalServices: z.boolean(),
  allowProductionDeployment: z.boolean(),
  allowForcePush: z.boolean(),
  allowSecretModification: z.boolean(),
  allowedNetworkHosts: z.array(z.string()),
  forbiddenPaths: z.array(z.string()),
  globalRetryBudget: z.number().int().nonnegative(),
  taskDefaults: TaskExecutionPolicySchema,
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const DEFAULT_SAFE_POLICY: ExecutionPolicy = {
  id: "default-safe",
  maxConcurrentTasks: 1,
  maxConcurrentBuilders: 1,
  requireCleanBaseBranch: true,
  requireWorkflowBranch: true,
  requireTaskCommits: true,
  allowParallelTasks: false,
  allowDestructiveMigrations: false,
  allowDependencyMajorUpgrades: false,
  allowPaidExternalServices: false,
  allowProductionDeployment: false,
  allowForcePush: false,
  allowSecretModification: false,
  allowedNetworkHosts: [],
  forbiddenPaths: [],
  globalRetryBudget: 12,
  taskDefaults: {
    maxBuilderAttempts: 3,
    maxRemediationCycles: 3,
    timeoutSeconds: 1800,
    heartbeatIntervalSeconds: 30,
    leaseDurationSeconds: 2100,
    allowNetworkAccess: false,
    allowDependencyChanges: false,
    allowSchemaChanges: false,
    requireCommit: true,
  },
};

export const PolicyViolationSeveritySchema = z.enum(["warning", "blocking"]);
export type PolicyViolationSeverity = z.infer<typeof PolicyViolationSeveritySchema>;

export const PolicyViolationSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  taskId: z.string().nullable().optional(),
  ruleId: z.string(),
  severity: PolicyViolationSeveritySchema,
  path: z.string().nullable().optional(),
  message: z.string(),
  evidence: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});
export type PolicyViolation = z.infer<typeof PolicyViolationSchema>;
