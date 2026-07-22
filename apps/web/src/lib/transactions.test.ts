import { beforeEach, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { workflowCoordinatorAbi } from "@agentsaga/contracts";
import { isPendingTransaction, loadPendingTransactions, recoverPendingTransaction, trackPendingTransaction, type PendingTransaction } from "./transactions";

const hash = `0x${"ab".repeat(32)}` as Hash;
const workflow = `0x${"12".repeat(20)}` as Address;
const owner = `0x${"34".repeat(20)}` as Address;
const base: PendingTransaction = { version: 1, action: "fund-workflow", chainId: 5_042_002, hash, workflow, createdAt: "2026-07-22T00:00:00.000Z", expectedEvent: "WorkflowFunded", expectedOwner: owner, expectedAmount: "100" };

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: new MemoryStorage(), dispatchEvent: () => true } });
});

function client(receipt?: TransactionReceipt, nonce = 0): PublicClient {
  return { chain: { id: 5_042_002 }, getTransactionReceipt: async () => { if (!receipt) throw new Error("not found"); return receipt; }, getTransactionCount: async () => nonce } as unknown as PublicClient;
}

function fundedReceipt(status: "success" | "reverted" = "success"): TransactionReceipt {
  return { status, logs: [{ address: workflow, topics: encodeEventTopics({ abi: workflowCoordinatorAbi, eventName: "WorkflowFunded", args: { owner } }), data: encodeAbiParameters([{ type: "uint96" }], [100n]) }] } as TransactionReceipt;
}

describe("transaction recovery", () => {
  it("rejects unknown actions and malformed records", () => { expect(isPendingTransaction({ ...base, action: "invented" })).toBe(false); expect(isPendingTransaction(base)).toBe(true); });
  it("decodes and completes the expected event", async () => { trackPendingTransaction(base); const result = await recoverPendingTransaction(client(fundedReceipt()), base); expect(result.status).toBe("Confirmed"); expect(result.decodedEvent).toBe("WorkflowFunded"); expect(loadPendingTransactions()).toEqual([]); });
  it("removes a reverted transaction from pending", async () => { trackPendingTransaction(base); expect((await recoverPendingTransaction(client(fundedReceipt("reverted")), base)).status).toBe("Reverted"); expect(loadPendingTransactions()).toEqual([]); });
  it("requires event amount and owner to match", async () => { const result = await recoverPendingTransaction(client(fundedReceipt()), { ...base, expectedAmount: "101" }); expect(result.status).toBe("Recovery required"); });
  it("detects wrong chain and nonce replacement", async () => { expect((await recoverPendingTransaction({ ...client(), chain: { id: 1 } } as PublicClient, base)).status).toBe("Recovery required"); trackPendingTransaction({ ...base, from: owner, nonce: 2 }); expect((await recoverPendingTransaction(client(undefined, 3), { ...base, from: owner, nonce: 2 })).status).toBe("Replaced"); });
});
