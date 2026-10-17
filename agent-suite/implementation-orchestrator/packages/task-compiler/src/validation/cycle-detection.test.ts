import { describe, expect, it } from "vitest";
import type { TaskDependency } from "@implementation-orchestrator/contracts";
import { findHardDependencyCycle } from "./cycle-detection.js";

function hardEdge(from: string, to: string): TaskDependency {
  return { fromTaskId: from, toTaskId: to, type: "hard", reason: "test" };
}

describe("findHardDependencyCycle", () => {
  it("returns null for an acyclic graph", () => {
    const deps = [hardEdge("b", "a"), hardEdge("c", "b")];
    expect(findHardDependencyCycle(["a", "b", "c"], deps)).toBeNull();
  });

  it("detects a direct cycle", () => {
    const deps = [hardEdge("a", "b"), hardEdge("b", "a")];
    const cycle = findHardDependencyCycle(["a", "b"], deps);
    expect(cycle).not.toBeNull();
  });

  it("detects an indirect cycle", () => {
    const deps = [hardEdge("a", "b"), hardEdge("b", "c"), hardEdge("c", "a")];
    const cycle = findHardDependencyCycle(["a", "b", "c"], deps);
    expect(cycle).not.toBeNull();
  });

  it("ignores soft dependencies when detecting cycles", () => {
    const deps: TaskDependency[] = [
      { fromTaskId: "a", toTaskId: "b", type: "soft", reason: "test" },
      { fromTaskId: "b", toTaskId: "a", type: "soft", reason: "test" },
    ];
    expect(findHardDependencyCycle(["a", "b"], deps)).toBeNull();
  });
});
