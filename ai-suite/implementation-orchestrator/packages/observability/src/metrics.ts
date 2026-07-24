import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const workflowsTotal = new Counter({
  name: "orchestrator_workflows_total",
  help: "Total number of workflows created.",
  registers: [registry],
});

export const workflowsCompletedTotal = new Counter({
  name: "orchestrator_workflows_completed_total",
  help: "Total number of workflows that reached completed.",
  registers: [registry],
});

export const workflowsFailedTotal = new Counter({
  name: "orchestrator_workflows_failed_total",
  help: "Total number of workflows that reached failed.",
  registers: [registry],
});

export const tasksTotal = new Counter({
  name: "orchestrator_tasks_total",
  help: "Total number of tasks compiled.",
  registers: [registry],
});

export const tasksAcceptedTotal = new Counter({
  name: "orchestrator_tasks_accepted_total",
  help: "Total number of tasks that reached accepted.",
  registers: [registry],
});

export const tasksFailedTotal = new Counter({
  name: "orchestrator_tasks_failed_total",
  help: "Total number of tasks that reached failed.",
  registers: [registry],
});

export const taskAttemptsTotal = new Counter({
  name: "orchestrator_task_attempts_total",
  help: "Total number of task attempts created.",
  labelNames: ["attempt_type"] as const,
  registers: [registry],
});

export const activeLeases = new Gauge({
  name: "orchestrator_active_leases",
  help: "Current number of active task leases.",
  registers: [registry],
});

export const expiredLeasesTotal = new Counter({
  name: "orchestrator_expired_leases_total",
  help: "Total number of leases that expired before release.",
  registers: [registry],
});

export const verificationRunsTotal = new Counter({
  name: "orchestrator_verification_runs_total",
  help: "Total number of verification runs executed.",
  registers: [registry],
});

export const verificationFailuresTotal = new Counter({
  name: "orchestrator_verification_failures_total",
  help: "Total number of verification runs that failed.",
  registers: [registry],
});

export const policyViolationsTotal = new Counter({
  name: "orchestrator_policy_violations_total",
  help: "Total number of policy violations recorded.",
  registers: [registry],
});

export const taskDurationSeconds = new Histogram({
  name: "orchestrator_task_duration_seconds",
  help: "Duration of a single task attempt, in seconds.",
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800],
  registers: [registry],
});

export const workflowDurationSeconds = new Histogram({
  name: "orchestrator_workflow_duration_seconds",
  help: "Duration of a workflow from creation to a terminal state, in seconds.",
  buckets: [5, 30, 60, 300, 900, 1800, 3600, 7200],
  registers: [registry],
});

export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export const METRICS_CONTENT_TYPE = registry.contentType;
