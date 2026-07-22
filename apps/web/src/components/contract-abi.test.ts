import { describe, expect, it } from "vitest";
import { getFunctionSelector } from "viem";
import { nodeStatusLabels, workflowCoordinatorAbi } from "@agentsaga/contracts";

describe("canonical contract bindings", () => {
  it("maps every Solidity NodeStatus value", () => {
    expect(nodeStatusLabels).toEqual([
      "Blocked", "Ready", "Funded", "Running", "Submitted", "Completed",
      "Rejected", "Failed", "Skipped", "Compensating", "Compensated", "Expired",
    ]);
  });

  it("uses the canonical cancelBeforeExecution selector", () => {
    const functions = workflowCoordinatorAbi.filter((item) => item.type === "function");
    expect(functions.some((item) => item.name === "cancelBeforeExecution")).toBe(true);
    expect(getFunctionSelector("cancelBeforeExecution()")).toBe("0x7d7b4dc7");
  });
});
