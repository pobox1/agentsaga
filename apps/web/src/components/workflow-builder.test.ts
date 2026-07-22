import { describe, expect, it } from "vitest";
import { hasCycle } from "./workflow-builder";

describe("workflow DAG validation", () => {
  it("accepts a canonical acyclic graph", () => expect(hasCycle([{ dependencies: [] }, { dependencies: [0] }, { dependencies: [0, 1] }])).toBe(false));
  it("rejects a dependency cycle", () => expect(hasCycle([{ dependencies: [1] }, { dependencies: [0] }])).toBe(true));
  it("rejects out-of-range dependencies", () => expect(hasCycle([{ dependencies: [2] }])).toBe(true));
});
