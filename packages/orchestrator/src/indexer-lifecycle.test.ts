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
  it("recovers an expired processing lease and never projects past the ordered head", async () => {
    const store = new InMemoryCursorStore();
    const first = { address: "0x1111111111111111111111111111111111111111", topics: [], data: "0x", transactionHash: `0x${"41".repeat(32)}`, transactionIndex: 0, blockHash: `0x${"51".repeat(32)}`, blockNumber: 10n, logIndex: 0, removed: false } as Log;
    const second = { ...first, transactionHash: `0x${"42".repeat(32)}`, logIndex: 1 } as Log;
    await store.putLogIfAbsent("ordered", second);
    await store.putLogIfAbsent("ordered", first);
    const [head] = await store.loadPendingLogs("ordered", 1);
    expect(head?.log.logIndex).toBe(0);
    expect(await store.claimProjection(head!.id, "crashed-projector", 0)).toBe(true);
    const calls: number[] = [];
    expect(await projectPendingEvents(store, "ordered", async (log) => { calls.push(log.logIndex!); })).toBe(2);
    expect(calls).toEqual([0, 1]);
  });
  it("blocks later projections while a receipt dependency is retrying", async () => {
    const store = new InMemoryCursorStore();
    const base = { address: "0x1111111111111111111111111111111111111111", topics: [], data: "0x", transactionIndex: 0, blockHash: `0x${"61".repeat(32)}`, blockNumber: 20n, removed: false } as Log;
    await store.putLogIfAbsent("receipt-order", { ...base, transactionHash: `0x${"62".repeat(32)}`, logIndex: 0 } as Log);
    await store.putLogIfAbsent("receipt-order", { ...base, transactionHash: `0x${"63".repeat(32)}`, logIndex: 1 } as Log);
    const calls: number[] = [];
    let dependencyReady = false;
    expect(await projectPendingEvents(store, "receipt-order", async (log) => {
      calls.push(log.logIndex!);
      if (!dependencyReady && log.logIndex === 0) throw new Error("receipt workflow dependency unavailable");
    })).toBe(0);
    expect(calls).toEqual([0]);
    dependencyReady = true;
    expect(await projectPendingEvents(store, "receipt-order", async (log) => { calls.push(log.logIndex!); })).toBe(2);
    expect(calls).toEqual([0, 0, 1]);
  });
});
