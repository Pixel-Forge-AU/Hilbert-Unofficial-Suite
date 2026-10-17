import { beforeEach, describe, expect, it } from "vitest";
import {
  METRICS_CONTENT_TYPE,
  activeLeases,
  registry,
  renderMetrics,
  taskAttemptsTotal,
  tasksAcceptedTotal,
  workflowsTotal,
} from "./metrics.js";

describe("observability metrics registry", () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it("exposes a Prometheus-compatible content type", () => {
    expect(METRICS_CONTENT_TYPE).toContain("text/plain");
  });

  it("renders incremented counters in the exposition output", async () => {
    workflowsTotal.inc();
    workflowsTotal.inc();
    tasksAcceptedTotal.inc();

    const output = await renderMetrics();

    expect(output).toContain("orchestrator_workflows_total 2");
    expect(output).toContain("orchestrator_tasks_accepted_total 1");
  });

  it("tracks labeled counters independently per label value", async () => {
    taskAttemptsTotal.inc({ attempt_type: "initial" });
    taskAttemptsTotal.inc({ attempt_type: "retry" });
    taskAttemptsTotal.inc({ attempt_type: "retry" });

    const output = await renderMetrics();

    expect(output).toContain('orchestrator_task_attempts_total{attempt_type="initial"} 1');
    expect(output).toContain('orchestrator_task_attempts_total{attempt_type="retry"} 2');
  });

  it("supports setting a gauge to an absolute value", async () => {
    activeLeases.set(4);
    activeLeases.set(2);

    const output = await renderMetrics();

    expect(output).toContain("orchestrator_active_leases 2");
  });
});
