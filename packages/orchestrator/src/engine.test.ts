import { describe, expect, it } from "vitest";
import { createDemoAgents } from "./agents.js";
import { vendorOnboardingDefinition } from "./demo.js";
import { InMemoryExecutionStore, WorkflowEngine } from "./engine.js";
import { DeterministicSchemaEvaluator } from "./evaluators.js";

describe("WorkflowEngine", () => {
  it("completes the deterministic success scenario", async () => {
    const engine = new WorkflowEngine(
      createDemoAgents(false),
      [new DeterministicSchemaEvaluator()],
      new InMemoryExecutionStore(),
    );
    const receipt = await engine.run(vendorOnboardingDefinition("success-test"));
    expect(receipt.finalStatus).toBe("completed");
    expect(receipt.completedNodeIds).toEqual([0, 1, 2, 3, 4]);
    expect(receipt.failedNodeIds).toEqual([]);
    expect(receipt.mode).toBe("local-deterministic-not-onchain");
  });

  it("stops descendants and compensates completed steps in reverse order", async () => {
    const engine = new WorkflowEngine(
      createDemoAgents(true),
      [new DeterministicSchemaEvaluator()],
      new InMemoryExecutionStore(),
    );
    const receipt = await engine.run(vendorOnboardingDefinition("failure-test"));
    expect(receipt.finalStatus).toBe("partially-completed");
    expect(receipt.failedNodeIds).toEqual([2]);
    expect(receipt.skippedNodeIds).toEqual([3, 4]);
    expect(receipt.compensatedNodeIds).toEqual([0, 1]);
    expect(receipt.records[1]?.compensation).toBeDefined();
    expect(receipt.records[0]?.compensation).toBeDefined();
  });

  it("rejects forward dependencies before execution", async () => {
    const engine = new WorkflowEngine(
      createDemoAgents(false),
      [new DeterministicSchemaEvaluator()],
      new InMemoryExecutionStore(),
    );
    const definition = vendorOnboardingDefinition("bad-dag");
    const first = definition.nodes[0];
    if (first === undefined) throw new Error("fixture missing root");
    first.dependencies = [1];
    await expect(engine.run(definition)).rejects.toThrow("non-topological dependency");
  });
});

