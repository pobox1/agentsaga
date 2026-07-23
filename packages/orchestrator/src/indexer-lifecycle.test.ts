import { describe, expect, it } from "vitest";
import type { Log } from "viem";
import { vi } from "vitest";
import { appendTransactionEvent, InMemoryCursorStore, projectPendingEvents, workflowJobType, workflowStatusUpdate } from "./indexer.js";

describe("indexer lifecycle projections", () => {
  it("never lets WorkflowFunded overwrite the authoritative Active status", () => {
    expect(workflowStatusUpdate("WorkflowFunded", undefined)).toBeUndefined();
    expect(workflowStatusUpdate("WorkflowStatusChanged", 2)).toEqual({ status: "Active", statusCode: 2, statusLabel: "Active" });
  });
  it("preserves every event emitted by one transaction", () => {
    const first = appendTransactionEvent(undefined, { eventName: "WorkflowStatusChanged", logIndex: 1, emitter: "0x1" });
    expect(appendTransactionEvent(first, { eventName: "WorkflowFunded", logIndex: 2, emitter: "0x1" }).events).toHaveLength(2);
    expect(appendTransactionEvent(first, { eventName: "WorkflowStatusChanged", logIndex: 1, emitter: "0x1" }).events).toHaveLength(1);
  });
  it("keeps original and remediation job types distinct", () => {
    expect(workflowJobType("JobCreated")).toBe("service"); expect(workflowJobType("CompensationJobOpened")).toBe("compensation");
  });
  it("retries a failed domain projection after durable raw ingestion without duplicating effects", async () => {
    const store = new InMemoryCursorStore();
    const log = { address: "0x1111111111111111111111111111111111111111", topics: [], data: "0x", transactionHash: `0x${"22".repeat(32)}`, transactionIndex: 0, blockHash: `0x${"33".repeat(32)}`, blockNumber: 1n, logIndex: 0, removed: false } as Log;
    expect(await store.putLogIfAbsent("source", log)).toBe(true);
    expect(await store.putLogIfAbsent("source", log)).toBe(false);
    const project = vi.fn().mockRejectedValueOnce(new Error("temporary receipt RPC failure")).mockResolvedValue(undefined);
    expect(await projectPendingEvents(store, "source", project)).toBe(0);
    expect(await projectPendingEvents(store, "source", project)).toBe(1);
    expect(await projectPendingEvents(store, "source", project)).toBe(0);
    expect(project).toHaveBeenCalledTimes(2);
  });
});
