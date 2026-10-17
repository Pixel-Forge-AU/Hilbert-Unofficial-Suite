import { describe, expect, it } from "vitest";
import { isValidTaskTransition, TASK_TRANSITIONS, TaskStatusSchema } from "./task.js";

describe("task transitions", () => {
  it("allows pending to move to ready or blocked", () => {
    expect(isValidTaskTransition("pending", "ready")).toBe(true);
    expect(isValidTaskTransition("pending", "blocked")).toBe(true);
  });

  it("rejects skipping straight from ready to accepted", () => {
    expect(isValidTaskTransition("ready", "accepted")).toBe(false);
  });

  it("treats accepted, failed, and cancelled as terminal", () => {
    expect(TASK_TRANSITIONS.accepted).toHaveLength(0);
    expect(TASK_TRANSITIONS.failed).toHaveLength(0);
    expect(TASK_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("covers every declared status with a transition entry", () => {
    for (const status of TaskStatusSchema.options) {
      expect(TASK_TRANSITIONS[status]).toBeDefined();
    }
  });
});
