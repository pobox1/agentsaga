import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { workflowCoordinatorAbi } from "@agentsaga/contracts";
import { dismissTransaction, enrichPendingTransactionNonce, isPendingTransaction, loadPendingTransactions, maximumAutomaticRecoveryAttempts, pendingTransactionFromHash, recoverPendingTransaction, trackPendingTransaction, type PendingTransaction, type TransactionAction } from "./transactions";
import { verifyTransactionEvent } from "./transaction-verification";

const hash = `0x${"ab".repeat(32)}` as Hash;
const workflow = `0x${"12".repeat(20)}` as Address;
const owner = `0x${"34".repeat(20)}` as Address;
const base: PendingTransaction = { version: 3, action: "fund-workflow", chainId: 5_042_002, hash, from: owner, nonce: 2, workflow, expectedEmitter: workflow, createdAt: "2026-07-22T00:00:00.000Z", recoveryAttempts: 0, nonceLookupAttempts: 0, expectedEvent: "WorkflowFunded", expectedOwner: owner, expectedAmount: 100n };

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: new MemoryStorage(), dispatchEvent: () => true, setTimeout } });
});

function client(receipt?: TransactionReceipt, nonce = 0): PublicClient {
  return { chain: { id: 5_042_002 }, getTransactionReceipt: async () => { if (!receipt) throw new Error("not found"); return receipt; }, getTransaction: async () => { throw new Error("not found"); }, getTransactionCount: async () => nonce } as unknown as PublicClient;
}

function fundedReceipt(status: "success" | "reverted" = "success"): TransactionReceipt {
  return { status, logs: [{ address: workflow, topics: encodeEventTopics({ abi: workflowCoordinatorAbi, eventName: "WorkflowFunded", args: { owner } }), data: encodeAbiParameters([{ type: "uint96" }], [100n]) }] } as TransactionReceipt;
}

describe("transaction recovery", () => {
  it("rejects unknown actions and malformed records", () => { expect(isPendingTransaction({ ...base, action: "invented" })).toBe(false); expect(isPendingTransaction(base)).toBe(true); });
  it("decodes and completes the expected event", async () => { trackPendingTransaction(base); const result = await recoverPendingTransaction(client(fundedReceipt()), base); expect(result.status).toBe("ConfirmedEventVerified"); expect(result.decodedEvent).toBe("WorkflowFunded"); expect(loadPendingTransactions()).toEqual([]); });
  it("removes a reverted transaction from pending", async () => { trackPendingTransaction(base); expect((await recoverPendingTransaction(client(fundedReceipt("reverted")), base)).status).toBe("Reverted"); expect(loadPendingTransactions()).toEqual([]); });
  it("requires event amount and owner to match", async () => { const result = await recoverPendingTransaction(client(fundedReceipt()), { ...base, expectedAmount: 101n }); expect(result.status).toBe("ConfirmedVerificationIncomplete"); });
  it("uses fresh state when a successful receipt has no decodable event", async () => {
    const stateClient = { ...client({ status: "success", logs: [] } as unknown as TransactionReceipt), readContract: async () => 100n } as unknown as PublicClient;
    expect((await recoverPendingTransaction(stateClient, base)).status).toBe("ConfirmedStateVerified");
  });
  it("persists the actual sender and nonce returned by RPC", async () => {
    const rpc = { getTransaction: async () => ({ from: owner, nonce: 17 }) } as unknown as PublicClient;
    const pending = await pendingTransactionFromHash(rpc, { action: "fund-workflow", chainId: 5_042_002, hash, from: owner, workflow });
    expect(pending).toMatchObject({ version: 3, from: owner, nonce: null, recoveryAttempts: 0 });
    await vi.waitFor(() => expect(loadPendingTransactions()[0]).toMatchObject({ nonce: 17 }));
  });
  it("persists a provisional hash before nonce lookup and can confirm by receipt first", async () => {
    const neverFound = { getTransaction: async () => { throw new Error("temporarily unavailable"); } } as unknown as PublicClient;
    const pending = await pendingTransactionFromHash(neverFound, { action: "fund-workflow", chainId: 5_042_002, hash, from: owner, workflow, expectedEmitter: workflow, expectedEvent: "WorkflowFunded", expectedOwner: owner, expectedAmount: 100n });
    expect(loadPendingTransactions()[0]).toMatchObject({ hash, nonce: null });
    expect((await recoverPendingTransaction(client(fundedReceipt()), pending)).status).toBe("ConfirmedEventVerified");
  });
  it("skips replacement detection while nonce is unknown", async () => {
    const provisional = { ...base, nonce: null };
    trackPendingTransaction(provisional);
    expect((await recoverPendingTransaction(client(undefined, 99), provisional)).status).toBe("Confirming");
    expect(loadPendingTransactions()).toHaveLength(1);
  });
  it("enriches nonce idempotently", async () => {
    trackPendingTransaction({ ...base, nonce: null });
    const rpc = { getTransaction: async () => ({ from: owner, nonce: 21 }) } as unknown as PublicClient;
    await Promise.all([enrichPendingTransactionNonce(rpc, hash), enrichPendingTransactionNonce(rpc, hash)]);
    expect(loadPendingTransactions()).toHaveLength(1); expect(loadPendingTransactions()[0]).toMatchObject({ nonce: 21 });
  });
  it("detects wrong chain and nonce replacement", async () => { expect((await recoverPendingTransaction({ ...client(), chain: { id: 1 } } as PublicClient, base)).status).toBe("RecoveryPaused"); trackPendingTransaction(base); expect((await recoverPendingTransaction(client(undefined, 3), base)).status).toBe("Replaced"); });
  it("keeps a temporarily unavailable hash confirming without inventing replacement", async () => { trackPendingTransaction(base); expect((await recoverPendingTransaction(client(undefined, 2), base)).status).toBe("Confirming"); expect(loadPendingTransactions()).toHaveLength(1); });
  it("bounds automatic recovery and supports dismiss", async () => { const exhausted = { ...base, recoveryAttempts: maximumAutomaticRecoveryAttempts }; trackPendingTransaction(exhausted); expect((await recoverPendingTransaction(client(), exhausted)).status).toBe("RecoveryPaused"); expect(dismissTransaction(hash)?.status).toBe("Dismissed"); expect(loadPendingTransactions()).toEqual([]); });
  it("verifies an ownerless coordinator event by node and job id", () => {
    const receipt = { status: "success", logs: [{ address: workflow, topics: encodeEventTopics({ abi: workflowCoordinatorAbi, eventName: "NodeActivated", args: { nodeId: 3, jobId: 44n } }), data: encodeAbiParameters([{ type: "uint96" }], [50n]) }] } as TransactionReceipt;
    const record = { ...base, action: "activate-node" as const, nodeId: 3, expectedJobId: 44n, expectedAmount: 50n, expectedEvent: "NodeActivated" };
    expect(verifyTransactionEvent(receipt, record).verified).toBe(true);
    expect(verifyTransactionEvent(receipt, { ...record, expectedJobId: 45n })).toMatchObject({ verified: false, reasonCode: "JOB_ID_MISMATCH" });
  });
  it("rejects a correct same-named event from the wrong emitter", () => {
    const wrong = `0x${"56".repeat(20)}` as Address;
    const receipt = { ...fundedReceipt(), logs: fundedReceipt().logs.map((log) => ({ ...log, address: wrong })) } as TransactionReceipt;
    expect(verifyTransactionEvent(receipt, base)).toMatchObject({ verified: false, reasonCode: "WRONG_EVENT_EMITTER" });
  });
  it("migrates valid v1 records and ignores invalid legacy records", () => {
    window.localStorage.setItem("agentsaga:pending-transactions:v1", JSON.stringify([{ ...base, version: 1, expectedAmount: "100" }, { version: 1, action: "fund-workflow" }]));
    const records = loadPendingTransactions(); expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ version: 3, nonce: 2, expectedAmount: 100n });
  });
  it("migrates v2 records without silently dropping a missing nonce", () => {
    window.localStorage.setItem("agentsaga:pending-transactions:v2", JSON.stringify([{ ...base, version: 2, nonce: null, expectedAmount: "100" }]));
    expect(loadPendingTransactions()[0]).toMatchObject({ version: 3, nonce: null });
  });
  it.each([
    "create-workflow", "approve-usdc", "fund-workflow", "activate-node", "approve-node", "submit-job", "complete-job", "reject-job", "claim-expiry", "open-compensation", "complete-compensation", "expire-compensation", "declare-unresolved", "expire-workflow", "cancel-before-execution",
  ] satisfies TransactionAction[])("has an explicit verifier for %s", (action) => {
    const result = verifyTransactionEvent({ status: "success", logs: [] } as unknown as TransactionReceipt, { ...base, action });
    expect(result).toMatchObject({ verified: false, reasonCode: "EXPECTED_EVENT_MISSING" });
  });
});
