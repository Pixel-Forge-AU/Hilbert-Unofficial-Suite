import { describe, expect, it } from "vitest";
import { detectCycle } from "../../src/plan-gate/graph.js";

describe("detectCycle", () => {
  it("returns null for an empty graph", () => {
    expect(detectCycle([])).toBeNull();
  });

  it("returns null for an acyclic graph", () => {
    const edges = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "A", to: "C" },
      { from: "D", to: "C" },
      { from: "E", to: "D" }
    ];
    expect(detectCycle(edges)).toBeNull();
  });

  it("detects a two-node cycle", () => {
    const edges = [
      { from: "A", to: "B" },
      { from: "B", to: "A" }
    ];
    expect(detectCycle(edges)).toEqual(["A", "B", "A"]);
  });

  it("detects a three-node cycle", () => {
    const edges = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "A" }
    ];
    expect(detectCycle(edges)).toEqual(["A", "B", "C", "A"]);
  });

  it("detects a self-loop", () => {
    expect(detectCycle([{ from: "A", to: "A" }])).toEqual(["A", "A"]);
  });
});
