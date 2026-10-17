import { describe, expect, it } from "vitest";
import { orderTasksForScheduling, selectRunnableTasks, type SchedulableTask } from "./scheduler.js";

function task(overrides: Partial<SchedulableTask> & Pick<SchedulableTask, "id">): SchedulableTask {
  return {
    priority: "normal",
    phaseOrder: 0,
    dependentCount: 0,
    readyAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("orderTasksForScheduling", () => {
  it("orders blocking before essential before high before normal before low", () => {
    const tasks = [
      task({ id: "low", priority: "low" }),
      task({ id: "blocking", priority: "blocking" }),
      task({ id: "normal", priority: "normal" }),
      task({ id: "essential", priority: "essential" }),
      task({ id: "high", priority: "high" }),
    ];
    expect(orderTasksForScheduling(tasks).map((t) => t.id)).toEqual([
      "blocking",
      "essential",
      "high",
      "normal",
      "low",
    ]);
  });

  it("breaks priority ties by earliest phase order", () => {
    const tasks = [
      task({ id: "later", priority: "essential", phaseOrder: 2 }),
      task({ id: "earlier", priority: "essential", phaseOrder: 0 }),
    ];
    expect(orderTasksForScheduling(tasks).map((t) => t.id)).toEqual(["earlier", "later"]);
  });

  it("breaks phase ties by highest dependent count", () => {
    const tasks = [
      task({ id: "few-dependents", priority: "essential", phaseOrder: 0, dependentCount: 1 }),
      task({ id: "many-dependents", priority: "essential", phaseOrder: 0, dependentCount: 5 }),
    ];
    expect(orderTasksForScheduling(tasks).map((t) => t.id)).toEqual(["many-dependents", "few-dependents"]);
  });

  it("breaks remaining ties by oldest ready timestamp", () => {
    const tasks = [
      task({ id: "newer", readyAt: new Date("2026-01-02T00:00:00Z") }),
      task({ id: "older", readyAt: new Date("2026-01-01T00:00:00Z") }),
    ];
    expect(orderTasksForScheduling(tasks).map((t) => t.id)).toEqual(["older", "newer"]);
  });
});

describe("selectRunnableTasks", () => {
  it("selects up to remaining concurrency capacity", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];
    const selected = selectRunnableTasks({ readyTasks: tasks, currentlyActiveCount: 1, maxConcurrentTasks: 2 });
    expect(selected).toHaveLength(1);
  });

  it("selects nothing when at or over capacity", () => {
    const tasks = [task({ id: "a" })];
    expect(selectRunnableTasks({ readyTasks: tasks, currentlyActiveCount: 2, maxConcurrentTasks: 2 })).toHaveLength(0);
    expect(selectRunnableTasks({ readyTasks: tasks, currentlyActiveCount: 5, maxConcurrentTasks: 2 })).toHaveLength(0);
  });

  it("respects ordering when selecting under capacity", () => {
    const tasks = [
      task({ id: "low", priority: "low" }),
      task({ id: "blocking", priority: "blocking" }),
      task({ id: "essential", priority: "essential" }),
    ];
    const selected = selectRunnableTasks({ readyTasks: tasks, currentlyActiveCount: 0, maxConcurrentTasks: 2 });
    expect(selected.map((t) => t.id)).toEqual(["blocking", "essential"]);
  });
});
