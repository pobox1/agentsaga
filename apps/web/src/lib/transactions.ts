import {
  decodeEventLog,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  agentJobAdapterAbi,
  erc20Abi,
  workflowCoordinatorAbi,
  workflowFactoryAbi,
} from "@agentsaga/contracts";

export type TransactionAction =
  | "create-workflow"
  | "approve-usdc"
  | "fund-workflow"
  | "activate-node"
  | "approve-node"
  | "submit-job"
  | "complete-job"
  | "reject-job"
  | "claim-expiry"
  | "open-compensation"
  | "complete-compensation"
  | "expire-compensation"
  | "declare-unresolved"
  | "expire-workflow"
  | "cancel-before-execution";

export type PendingTransaction = {
  version: 1;
  action: TransactionAction;
  chainId: number;
  hash: Hash;
  workflow?: Address | undefined;
  nodeId?: number | undefined;
  createdAt: string;
  expectedEvent?: string | undefined;
  expectedOwner?: Address | undefined;
  expectedAmount?: string | undefined;
  from?: Address | undefined;
  nonce?: number | undefined;
};

export type TransactionCenterStatus =
  | "Preparing"
  | "Awaiting signature"
  | "Submitted"
  | "Confirming"
  | "Confirmed"
  | "Reverted"
  | "Replaced"
  | "Recovery required";

export type TransactionRecord = PendingTransaction & {
  status: TransactionCenterStatus;
  confirmedAt?: string | undefined;
  decodedEvent?: string | undefined;
  error?: string | undefined;
  resultingWorkflow?: Address | undefined;
};

const pendingKey = "agentsaga:pending-transactions:v1";
const historyKey = "agentsaga:transaction-history:v1";
export const transactionUpdateEvent = "agentsaga:transactions-updated";
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function readArray(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function isPendingTransaction(value: unknown): value is PendingTransaction {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && transactionActions.has(String(item.action))
    && typeof item.chainId === "number" && Number.isInteger(item.chainId) && item.chainId > 0 && typeof item.hash === "string"
    && hashPattern.test(item.hash) && typeof item.createdAt === "string"
    && (item.workflow === undefined || typeof item.workflow === "string" && addressPattern.test(item.workflow));
}

const transactionActions = new Set<string>(["create-workflow", "approve-usdc", "fund-workflow", "activate-node", "approve-node", "submit-job", "complete-job", "reject-job", "claim-expiry", "open-compensation", "complete-compensation", "expire-compensation", "declare-unresolved", "expire-workflow", "cancel-before-execution"] satisfies TransactionAction[]);

export function loadPendingTransactions(): PendingTransaction[] {
  return readArray(pendingKey).filter(isPendingTransaction);
}

export function loadTransactionHistory(): TransactionRecord[] {
  return readArray(historyKey).filter((value): value is TransactionRecord =>
    isPendingTransaction(value) && typeof (value as TransactionRecord).status === "string");
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(transactionUpdateEvent));
}

function storeHistory(record: TransactionRecord) {
  const history = loadTransactionHistory().filter((item) => item.hash !== record.hash);
  window.localStorage.setItem(historyKey, JSON.stringify([record, ...history].slice(0, 100)));
}

export function trackPendingTransaction(record: PendingTransaction) {
  const pending = loadPendingTransactions().filter((item) => item.hash !== record.hash);
  window.localStorage.setItem(pendingKey, JSON.stringify([record, ...pending]));
  storeHistory({ ...record, status: "Submitted" });
  notify();
}

function finish(record: PendingTransaction, result: Omit<TransactionRecord, keyof PendingTransaction>) {
  const pending = loadPendingTransactions().filter((item) => item.hash !== record.hash);
  window.localStorage.setItem(pendingKey, JSON.stringify(pending));
  storeHistory({ ...record, ...result });
  notify();
}

const eventAbis = [workflowFactoryAbi, workflowCoordinatorAbi, agentJobAdapterAbi, erc20Abi] as const;

function decodeExpectedEvent(receipt: TransactionReceipt, record: PendingTransaction) {
  const coordinatorEvents = new Set([
    "WorkflowFunded", "WorkflowStatusChanged", "NodeReady", "NodeApproved", "NodeActivated",
    "NodeSubmitted", "NodeCompleted", "NodeRejected", "NodeSkipped", "CompensationPlanned",
    "CompensationJobOpened", "CompensationCompleted", "CompensationUnresolved", "Refunded",
  ]);
  for (const log of receipt.logs) {
    for (const abi of eventAbis) {
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (record.expectedEvent && decoded.eventName !== record.expectedEvent) continue;
        const args = decoded.args as Record<string, unknown>;
        if (record.workflow && coordinatorEvents.has(decoded.eventName)
          && log.address.toLowerCase() !== record.workflow.toLowerCase()) continue;
        if (decoded.eventName === "Approval" && record.workflow
          && String(args.spender).toLowerCase() !== record.workflow.toLowerCase()) continue;
        if (record.nodeId !== undefined && (!("nodeId" in args) || Number(args.nodeId) !== record.nodeId)) continue;
        if (record.expectedOwner && (!("owner" in args)
          || String(args.owner).toLowerCase() !== record.expectedOwner.toLowerCase())) continue;
        if (record.expectedAmount) {
          const amount = "amount" in args ? args.amount : "value" in args ? args.value : undefined;
          if (amount === undefined || String(amount) !== record.expectedAmount) continue;
        }
        const resultingWorkflow = decoded.eventName === "WorkflowCreated"
          ? args.workflow as Address
          : record.workflow;
        return { eventName: decoded.eventName, resultingWorkflow };
      } catch {
        // Try the next project ABI; unknown third-party logs are expected.
      }
    }
  }
  return undefined;
}

export async function recoverPendingTransaction(
  client: PublicClient,
  record: PendingTransaction,
): Promise<TransactionRecord> {
  if (client.chain?.id !== record.chainId) {
    return { ...record, status: "Recovery required", error: `Switch to chain ${record.chainId}` };
  }
  let receipt: TransactionReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: record.hash });
  } catch {
    if (record.from && record.nonce !== undefined) {
      const confirmedNonce = await client.getTransactionCount({ address: record.from });
      if (confirmedNonce > record.nonce) {
        const result = { ...record, status: "Replaced" as const, error: "Account nonce advanced without this hash" };
        finish(record, result);
        return result;
      }
    }
    const result = { ...record, status: "Confirming" as const };
    storeHistory(result);
    return result;
  }
  if (receipt.status === "reverted") {
    const result = { ...record, status: "Reverted" as const, confirmedAt: new Date().toISOString() };
    finish(record, result);
    return result;
  }
  const decoded = decodeExpectedEvent(receipt, record);
  if (record.expectedEvent && !decoded) {
    const result = { ...record, status: "Recovery required" as const, error: `Missing or mismatched ${record.expectedEvent}` };
    storeHistory(result);
    return result;
  }
  const result = {
    ...record,
    status: "Confirmed" as const,
    confirmedAt: new Date().toISOString(),
    decodedEvent: decoded?.eventName,
    resultingWorkflow: decoded?.resultingWorkflow,
  };
  finish(record, result);
  return result;
}
