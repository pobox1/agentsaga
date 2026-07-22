import { describe, expect, it } from "vitest";
import { appendTransactionEvent, workflowJobType, workflowStatusUpdate } from "./indexer.js";

describe("indexer lifecycle projections", () => {
  it("never lets WorkflowFunded overwrite the authoritative Active status", () => {
    expect(workflowStatusUpdate("WorkflowFunded", undefined)).toBeUndefined();
    expect(workflowStatusUpdate("WorkflowStatusChanged", 2)).toEqual({ status: "Active", statusCode: 2, statusLabel: "Active" });
  });
  it("preserves every event emitted by one transaction", () => {
    const first = appendTransactionEvent(undefined, { eventName: "WorkflowStatusChanged", logIndex: 1, emitter: "0x1" });
    expect(appendTransactionEvent(first, { eventName: "WorkflowFunded", logIndex: 2, emitter: "0x1" }).events).toHaveLength(2);
  });
  it("keeps original and remediation job types distinct", () => {
    expect(workflowJobType("JobCreated")).toBe("service"); expect(workflowJobType("CompensationJobOpened")).toBe("compensation");
  });
});
