import type { Address, Hash, PublicClient, TransactionReceipt } from "viem";
import { decodeProjectEvents, verifyCurrentState, verifyTransactionEvent } from "./transaction-verification";

export type TransactionAction = "create-workflow" | "approve-usdc" | "fund-workflow" | "activate-node" | "approve-node" | "submit-job" | "complete-job" | "reject-job" | "claim-expiry" | "open-compensation" | "complete-compensation" | "expire-compensation" | "declare-unresolved" | "expire-workflow" | "cancel-before-execution";

export type PendingTransaction = {
  version: 3;
  action: TransactionAction;
  chainId: number;
  hash: Hash;
  from: Address;
  nonce: number | null;
  workflow?: Address;
  nodeId?: number;
  jobId?: bigint;
  expectedJobId?: bigint;
  expectedEmitter?: Address;
  expectedEvent?: string;
  expectedOwner?: Address;
  expectedApprover?: Address;
  expectedProvider?: Address;
  expectedEvaluator?: Address;
  expectedSpender?: Address;
  expectedAmount?: bigint;
  expectedFinalStatus?: number;
  expectedSpecificationHash?: Hash;
  expectedDeliverableHash?: Hash;
  createdAt: string;
  lastCheckedAt?: string;
  recoveryAttempts: number;
  nonceLookupAttempts: number;
};

export type TransactionCenterStatus = "Preparing" | "AwaitingSignature" | "Submitted" | "Confirming" | "ConfirmedEventVerified" | "ConfirmedStateVerified" | "ConfirmedVerificationIncomplete" | "Reverted" | "Replaced" | "Dropped" | "RecoveryPaused" | "Dismissed";
export type VerificationMethod = "event" | "state" | "incomplete" | "none";
export type TransactionRecord = PendingTransaction & { status: TransactionCenterStatus; confirmedAt?: string; decodedEvent?: string; decodedEvents?: string[]; verificationMethod?: VerificationMethod; errorCode?: string; error?: string; resultingWorkflow?: Address; replacementHash?: Hash };

const pendingKey = "agentsaga:pending-transactions:v3";
const historyKey = "agentsaga:transaction-history:v3";
const quarantineKey = "agentsaga:transaction-quarantine";
const v2PendingKey = "agentsaga:pending-transactions:v2";
const v2HistoryKey = "agentsaga:transaction-history:v2";
const legacyPendingKey = "agentsaga:pending-transactions:v1";
const legacyHistoryKey = "agentsaga:transaction-history:v1";
export const transactionUpdateEvent = "agentsaga:transactions-updated";
export const maximumAutomaticRecoveryAttempts = 8;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const actions = new Set<string>(["create-workflow", "approve-usdc", "fund-workflow", "activate-node", "approve-node", "submit-job", "complete-job", "reject-job", "claim-expiry", "open-compensation", "complete-compensation", "expire-compensation", "declare-unresolved", "expire-workflow", "cancel-before-execution"] satisfies TransactionAction[]);
const terminal = new Set<TransactionCenterStatus>(["ConfirmedEventVerified", "ConfirmedStateVerified", "ConfirmedVerificationIncomplete", "Reverted", "Replaced", "Dropped", "Dismissed"]);
const statuses = new Set<TransactionCenterStatus>(["Preparing", "AwaitingSignature", "Submitted", "Confirming", "ConfirmedEventVerified", "ConfirmedStateVerified", "ConfirmedVerificationIncomplete", "Reverted", "Replaced", "Dropped", "RecoveryPaused", "Dismissed"]);

function parse(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]", (_key, item: unknown) => isBigIntEnvelope(item) ? BigInt(item.$bigint) : item); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function stringify(value: unknown) { return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? { $bigint: item.toString() } : item); }
function isBigIntEnvelope(value: unknown): value is { $bigint: string } { return typeof value === "object" && value !== null && "$bigint" in value && typeof (value as { $bigint?: unknown }).$bigint === "string"; }
function validAddress(value: unknown): value is Address { return typeof value === "string" && addressPattern.test(value); }
function validHash(value: unknown): value is Hash { return typeof value === "string" && hashPattern.test(value); }

export function isPendingTransaction(value: unknown): value is PendingTransaction {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.version === 3 && actions.has(String(item.action)) && Number.isInteger(item.chainId) && Number(item.chainId) > 0
    && validHash(item.hash) && validAddress(item.from) && (item.nonce === null || Number.isInteger(item.nonce) && Number(item.nonce) >= 0)
    && typeof item.createdAt === "string" && Number.isInteger(item.recoveryAttempts) && Number(item.recoveryAttempts) >= 0 && Number.isInteger(item.nonceLookupAttempts) && Number(item.nonceLookupAttempts) >= 0
    && (item.workflow === undefined || validAddress(item.workflow)) && (item.expectedEmitter === undefined || validAddress(item.expectedEmitter))
    && (item.nodeId === undefined || Number.isInteger(item.nodeId) && Number(item.nodeId) >= 0 && Number(item.nodeId) < 16);
}

function migrateLegacy(): void {
  if (typeof window === "undefined") return;
  const quarantine: Array<{ record: unknown; reason: string }> = [];
  const migrate = (value: unknown): PendingTransaction | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    const old = value as Record<string, unknown>;
    if ((old.version !== 1 && old.version !== 2) || !actions.has(String(old.action)) || !validHash(old.hash) || !validAddress(old.from) || !Number.isInteger(old.chainId) || typeof old.createdAt !== "string") { quarantine.push({ record: value, reason: "Legacy transaction is missing a valid action, chain, hash, sender, or creation time" }); return undefined; }
    const nonce = Number.isInteger(old.nonce) && Number(old.nonce) >= 0 ? Number(old.nonce) : null;
    const expectedAmount = typeof old.expectedAmount === "string" && /^\d+$/.test(old.expectedAmount) ? BigInt(old.expectedAmount) : undefined;
    return { ...old, version: 3, action: old.action as TransactionAction, chainId: Number(old.chainId), hash: old.hash, from: old.from, nonce, createdAt: old.createdAt, recoveryAttempts: Number.isInteger(old.recoveryAttempts) ? Number(old.recoveryAttempts) : 0, nonceLookupAttempts: 0,
      ...(validAddress(old.workflow) ? { workflow: old.workflow } : {}), ...(typeof old.nodeId === "number" ? { nodeId: old.nodeId } : {}), ...(typeof old.expectedEvent === "string" ? { expectedEvent: old.expectedEvent } : {}), ...(validAddress(old.expectedOwner) ? { expectedOwner: old.expectedOwner } : {}), ...(expectedAmount === undefined ? {} : { expectedAmount }) } as PendingTransaction;
  };
  if (window.localStorage.getItem(pendingKey) === null) {
    const pending = [...parse(v2PendingKey), ...parse(legacyPendingKey)].map(migrate).filter((item): item is PendingTransaction => Boolean(item));
    window.localStorage.setItem(pendingKey, stringify(pending));
  }
  if (window.localStorage.getItem(historyKey) === null) {
    const history = [...parse(v2HistoryKey), ...parse(legacyHistoryKey)].map(migrate).filter((item): item is PendingTransaction => Boolean(item)).map((item) => ({ ...item, status: item.nonce === null ? "RecoveryPaused" as const : "Submitted" as const, errorCode: "LEGACY_RECORD_MIGRATED", error: "Legacy transaction was preserved for recovery" }));
    window.localStorage.setItem(historyKey, stringify(history));
  }
  if (quarantine.length) window.localStorage.setItem(quarantineKey, stringify(quarantine));
}

export function loadPendingTransactions(): PendingTransaction[] { migrateLegacy(); return parse(pendingKey).filter(isPendingTransaction); }
export function loadTransactionHistory(): TransactionRecord[] { migrateLegacy(); return parse(historyKey).filter((value): value is TransactionRecord => isPendingTransaction(value) && statuses.has((value as TransactionRecord).status)); }
function notify() { if (typeof window !== "undefined") window.dispatchEvent(new Event(transactionUpdateEvent)); }
function savePending(records: PendingTransaction[]) { window.localStorage.setItem(pendingKey, stringify(records)); }
function storeHistory(record: TransactionRecord) { const history = loadTransactionHistory().filter((item) => item.hash !== record.hash); window.localStorage.setItem(historyKey, stringify([record, ...history].slice(0, 100))); }
function updatePending(record: PendingTransaction) { savePending([record, ...loadPendingTransactions().filter((item) => item.hash !== record.hash)]); }

export function trackPendingTransaction(record: PendingTransaction) { updatePending(record); storeHistory({ ...record, status: "Submitted", verificationMethod: "none" }); notify(); }
function finish(record: PendingTransaction, result: Omit<TransactionRecord, keyof PendingTransaction>) { savePending(loadPendingTransactions().filter((item) => item.hash !== record.hash)); const completed = { ...record, ...result }; storeHistory(completed); notify(); return completed; }

export async function pendingTransactionFromHash(client: PublicClient, input: Omit<PendingTransaction, "version" | "nonce" | "createdAt" | "recoveryAttempts" | "nonceLookupAttempts">): Promise<PendingTransaction> {
  const provisional: PendingTransaction = { ...input, version: 3, nonce: null, createdAt: new Date().toISOString(), recoveryAttempts: 0, nonceLookupAttempts: 0 };
  trackPendingTransaction(provisional);
  void enrichPendingTransactionNonce(client, provisional.hash);
  return provisional;
}

export async function enrichPendingTransactionNonce(client: PublicClient, hash: Hash): Promise<PendingTransaction | undefined> {
  for (const delay of [0, 200, 500, 1_000, 2_000, 4_000]) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    const current = loadPendingTransactions().find((record) => record.hash === hash);
    if (!current || current.nonce !== null) return current;
    const attempted = { ...current, nonceLookupAttempts: current.nonceLookupAttempts + 1, lastCheckedAt: new Date().toISOString() };
    updatePending(attempted);
    try {
      const transaction = await client.getTransaction({ hash });
      const latest = loadPendingTransactions().find((record) => record.hash === hash);
      if (!latest) return undefined;
      const enriched = { ...latest, from: transaction.from, nonce: transaction.nonce };
      updatePending(enriched); storeHistory({ ...enriched, status: "Submitted", verificationMethod: "none" }); notify(); return enriched;
    } catch { /* Keep the provisional record and retry with bounded backoff. */ }
  }
  return loadPendingTransactions().find((record) => record.hash === hash);
}

export async function recoverPendingTransaction(client: PublicClient, record: PendingTransaction, options: { manual?: boolean } = {}): Promise<TransactionRecord> {
  if (!options.manual && record.recoveryAttempts >= maximumAutomaticRecoveryAttempts) return pause(record, "RETRY_LIMIT_REACHED", "Automatic recovery paused; retry or dismiss manually");
  if (client.chain?.id !== record.chainId) return pause(record, "WRONG_CHAIN", `Switch to chain ${record.chainId}`);
  const checking = { ...record, recoveryAttempts: record.recoveryAttempts + 1, lastCheckedAt: new Date().toISOString() };
  updatePending(checking);
  let receipt: TransactionReceipt;
  try { receipt = await client.getTransactionReceipt({ hash: record.hash }); }
  catch {
    const unavailable = await recoverUnavailableHash(client, checking);
    if (unavailable) return unavailable;
    if (checking.recoveryAttempts >= maximumAutomaticRecoveryAttempts) return pause(checking, "RETRY_LIMIT_REACHED", "Transaction is still unavailable; automatic recovery paused");
    const confirming: TransactionRecord = { ...checking, status: "Confirming", verificationMethod: "none", errorCode: "RECEIPT_NOT_AVAILABLE" };
    storeHistory(confirming); notify(); return confirming;
  }
  if (receipt.status === "reverted") return finish(checking, { status: "Reverted", confirmedAt: new Date().toISOString(), verificationMethod: "none", errorCode: "TRANSACTION_REVERTED" });
  const decodedEvents = decodeProjectEvents(receipt).map((item) => `${item.eventName}@${item.emitter}`);
  const eventResult = verifyTransactionEvent(receipt, checking);
  if (eventResult.verified) return finish(checking, { status: "ConfirmedEventVerified", confirmedAt: new Date().toISOString(), decodedEvent: eventResult.eventName, decodedEvents, verificationMethod: "event", ...(eventResult.workflow ? { resultingWorkflow: eventResult.workflow } : {}) });
  const stateResult = await verifyCurrentState(client, checking);
  if (stateResult.verified) return finish(checking, { status: "ConfirmedStateVerified", confirmedAt: new Date().toISOString(), decodedEvents, verificationMethod: "state", errorCode: eventResult.reasonCode, error: eventResult.details, ...(stateResult.workflow ? { resultingWorkflow: stateResult.workflow } : {}) });
  return finish(checking, { status: "ConfirmedVerificationIncomplete", confirmedAt: new Date().toISOString(), decodedEvents, verificationMethod: "incomplete", errorCode: eventResult.reasonCode, error: `${eventResult.details}; ${stateResult.details}` });
}

async function recoverUnavailableHash(client: PublicClient, record: PendingTransaction): Promise<TransactionRecord | undefined> {
  try { await client.getTransaction({ hash: record.hash }); return undefined; } catch { /* Continue with nonce evidence. */ }
  if (record.nonce === null) return undefined;
  const knownNonce = record.nonce;
  try {
    const [confirmedNonce, pendingNonce] = await Promise.all([
      client.getTransactionCount({ address: record.from, blockTag: "latest" }),
      client.getTransactionCount({ address: record.from, blockTag: "pending" }).catch(() => knownNonce),
    ]);
    if (confirmedNonce <= knownNonce) return undefined;
    const replacementHash = await findReplacement(client, record.from, knownNonce);
    return finish(record, { status: "Replaced", verificationMethod: "none", errorCode: "NONCE_CONFIRMED_BY_OTHER_TRANSACTION", error: pendingNonce > knownNonce ? "Sender nonce advanced and the original hash is unavailable" : "Confirmed nonce advanced past this transaction", ...(replacementHash ? { replacementHash } : {}) });
  } catch { return undefined; }
}

async function findReplacement(client: PublicClient, from: Address, nonce: number): Promise<Hash | undefined> {
  try {
    const latest = await client.getBlockNumber();
    for (let offset = 0n; offset < 20n && latest >= offset; offset++) {
      const block = await client.getBlock({ blockNumber: latest - offset, includeTransactions: true });
      const found = block.transactions.find((transaction) => typeof transaction !== "string" && transaction.nonce === nonce && transaction.from.toLowerCase() === from.toLowerCase());
      if (found && typeof found !== "string") return found.hash;
    }
  } catch { /* Replacement hash is supplementary; nonce evidence remains authoritative. */ }
  return undefined;
}

function pause(record: PendingTransaction, errorCode: string, error: string): TransactionRecord { const pending = { ...record, lastCheckedAt: new Date().toISOString(), recoveryAttempts: maximumAutomaticRecoveryAttempts }; const paused = { ...pending, status: "RecoveryPaused" as const, verificationMethod: "none" as const, errorCode, error }; updatePending(pending); storeHistory(paused); notify(); return paused; }
export async function retryTransactionRecovery(client: PublicClient, hash: Hash): Promise<TransactionRecord | undefined> { const record = loadPendingTransactions().find((item) => item.hash === hash); if (!record) return undefined; const reset = { ...record, recoveryAttempts: 0 }; updatePending(reset); return recoverPendingTransaction(client, reset, { manual: true }); }
export function dismissTransaction(hash: Hash): TransactionRecord | undefined { const record = loadPendingTransactions().find((item) => item.hash === hash); if (!record) return undefined; return finish(record, { status: "Dismissed", verificationMethod: "none", errorCode: "DISMISSED_BY_USER" }); }
export function isTerminalTransactionStatus(status: TransactionCenterStatus) { return terminal.has(status); }
export function automaticRecoveryDue(record: PendingTransaction, now = Date.now()): boolean {
  if (record.recoveryAttempts >= maximumAutomaticRecoveryAttempts) return false;
  if (!record.lastCheckedAt) return true;
  const delay = Math.min(60_000, 2_000 * 2 ** Math.max(0, record.recoveryAttempts - 1));
  return now - Date.parse(record.lastCheckedAt) >= delay;
}
