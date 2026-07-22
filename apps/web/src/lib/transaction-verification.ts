import { decodeEventLog, type Address, type PublicClient, type TransactionReceipt } from "viem";
import { erc20Abi, workflowCoordinatorAbi, workflowFactoryAbi } from "@agentsaga/contracts";
import type { PendingTransaction } from "./transactions";

export type VerificationResult =
  | { verified: true; eventName: string; emitter: Address; workflow?: Address; nodeId?: number; jobId?: bigint }
  | { verified: false; reasonCode: string; details: string };
type VerificationFailure = Extract<VerificationResult, { verified: false }>;

type Event = { eventName: string; emitter: Address; args: Record<string, unknown> };
const abis = [workflowFactoryAbi, workflowCoordinatorAbi, erc20Abi] as const;

export function decodeProjectEvents(receipt: TransactionReceipt): Event[] {
  const events: Event[] = [];
  for (const log of receipt.logs) {
    for (const abi of abis) {
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        events.push({ eventName: decoded.eventName, emitter: log.address, args: decoded.args as Record<string, unknown> });
        break;
      } catch { /* A transaction may contain unrelated third-party logs. */ }
    }
  }
  return events;
}

function event(receipt: TransactionReceipt, record: PendingTransaction, name: string): Event | VerificationFailure {
  const named = decodeProjectEvents(receipt).filter((item) => item.eventName === name);
  if (!record.expectedEmitter) return fail("MISSING_EXPECTED_EMITTER", `${record.action} has no expected emitter`);
  const matched = named.find((item) => equalAddress(item.emitter, record.expectedEmitter));
  if (matched) return matched;
  if (named.length) return fail("WRONG_EVENT_EMITTER", `${name} was emitted by a different contract`);
  return fail("EXPECTED_EVENT_MISSING", `${name} was not decoded from the successful receipt`);
}

function isFailure(value: Event | VerificationFailure): value is VerificationFailure {
  return "verified" in value;
}
function fail(reasonCode: string, details: string): VerificationFailure { return { verified: false, reasonCode, details }; }
function equalAddress(value: unknown, expected: Address | undefined) { return Boolean(expected && typeof value === "string" && value.toLowerCase() === expected.toLowerCase()); }
function equalNumber(value: unknown, expected: number | undefined) { return expected === undefined || Number(value) === expected; }
function equalBigInt(value: unknown, expected: bigint | undefined) { return expected === undefined || typeof value === "bigint" && value === expected; }
function success(item: Event, extra: { workflow?: Address | undefined; nodeId?: number | undefined; jobId?: bigint | undefined } = {}): VerificationResult {
  return { verified: true, eventName: item.eventName, emitter: item.emitter, ...(extra.workflow === undefined ? {} : { workflow: extra.workflow }), ...(extra.nodeId === undefined ? {} : { nodeId: extra.nodeId }), ...(extra.jobId === undefined ? {} : { jobId: extra.jobId }) };
}

export function verifyWorkflowCreated(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "WorkflowCreated"); if (isFailure(item)) return item;
  if (!equalAddress(item.args.owner, record.expectedOwner)) return fail("OWNER_MISMATCH", "WorkflowCreated owner does not match");
  if (record.workflow && !equalAddress(item.args.workflow, record.workflow)) return fail("WORKFLOW_MISMATCH", "WorkflowCreated workflow does not match prediction");
  if (record.expectedSpecificationHash && item.args.workflowSpecificationHash !== record.expectedSpecificationHash) return fail("SPECIFICATION_HASH_MISMATCH", "Workflow specification hash does not match");
  return success(item, { workflow: item.args.workflow as Address });
}

export function verifyApproval(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "Approval"); if (isFailure(item)) return item;
  if (!equalAddress(item.args.owner, record.expectedOwner)) return fail("OWNER_MISMATCH", "Approval owner does not match sender");
  if (!equalAddress(item.args.spender, record.expectedSpender ?? record.workflow)) return fail("SPENDER_MISMATCH", "Approval spender does not match workflow");
  if (!equalBigInt(item.args.value, record.expectedAmount)) return fail("AMOUNT_MISMATCH", "Approval amount does not match");
  return success(item, { workflow: record.workflow });
}

export function verifyWorkflowFunded(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "WorkflowFunded"); if (isFailure(item)) return item;
  if (!equalAddress(item.args.owner, record.expectedOwner)) return fail("OWNER_MISMATCH", "WorkflowFunded owner does not match");
  if (!equalBigInt(item.args.amount, record.expectedAmount)) return fail("AMOUNT_MISMATCH", "Funded amount does not match");
  return success(item, { workflow: record.workflow });
}

export function verifyNodeApproved(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "NodeApproved"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Approved node does not match");
  if (!equalAddress(item.args.approver, record.expectedApprover)) return fail("APPROVER_MISMATCH", "Node approver does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId) });
}

export function verifyNodeActivated(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "NodeActivated"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Activated node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Activated job does not match");
  if (!equalBigInt(item.args.budget, record.expectedAmount)) return fail("AMOUNT_MISMATCH", "Activated budget does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyNodeSubmitted(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "NodeSubmitted"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Submitted node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Submitted job does not match");
  if (record.expectedDeliverableHash && item.args.deliverableHash !== record.expectedDeliverableHash) return fail("DELIVERABLE_HASH_MISMATCH", "Deliverable commitment does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyNodeCompleted(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "NodeCompleted"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Completed node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Completed job does not match");
  if (record.expectedProvider && !equalAddress(item.args.provider, record.expectedProvider)) return fail("PROVIDER_MISMATCH", "Paid provider does not match");
  if (record.expectedAmount !== undefined && (item.args.paid as bigint) + (item.args.fee as bigint) !== record.expectedAmount) return fail("AMOUNT_MISMATCH", "Provider payment plus fee does not match budget");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyNodeRejected(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "NodeRejected"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Rejected node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Rejected job does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyCompensationOpened(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "CompensationJobOpened"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Compensation node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Compensation job does not match");
  if (record.expectedProvider && !equalAddress(item.args.provider, record.expectedProvider)) return fail("PROVIDER_MISMATCH", "Compensation provider does not match");
  if (!equalBigInt(item.args.budget, record.expectedAmount)) return fail("AMOUNT_MISMATCH", "Compensation budget does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyCompensationCompleted(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "CompensationCompleted"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Compensation node does not match");
  if (!equalBigInt(item.args.jobId, record.expectedJobId ?? record.jobId)) return fail("JOB_ID_MISMATCH", "Compensation job does not match");
  if (!equalBigInt(item.args.spent, record.expectedAmount)) return fail("AMOUNT_MISMATCH", "Compensation spend does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId), jobId: item.args.jobId as bigint });
}

export function verifyCompensationUnresolved(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "CompensationUnresolved"); if (isFailure(item)) return item;
  if (!equalNumber(item.args.nodeId, record.nodeId)) return fail("NODE_ID_MISMATCH", "Unresolved compensation node does not match");
  return success(item, { workflow: record.workflow, nodeId: Number(item.args.nodeId) });
}

export function verifyWorkflowFinalized(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  const item = event(receipt, record, "WorkflowStatusChanged"); if (isFailure(item)) return item;
  if (record.expectedFinalStatus !== undefined && Number(item.args.current) !== record.expectedFinalStatus) return fail("FINAL_STATUS_MISMATCH", "Workflow final status does not match");
  return success(item, { workflow: record.workflow });
}

export function verifyTransactionEvent(receipt: TransactionReceipt, record: PendingTransaction): VerificationResult {
  switch (record.action) {
    case "create-workflow": return verifyWorkflowCreated(receipt, record);
    case "approve-usdc": return verifyApproval(receipt, record);
    case "fund-workflow": return verifyWorkflowFunded(receipt, record);
    case "approve-node": return verifyNodeApproved(receipt, record);
    case "activate-node": return verifyNodeActivated(receipt, record);
    case "submit-job": return verifyNodeSubmitted(receipt, record);
    case "complete-job": return verifyNodeCompleted(receipt, record);
    case "reject-job": case "claim-expiry": return verifyNodeRejected(receipt, record);
    case "open-compensation": return verifyCompensationOpened(receipt, record);
    case "complete-compensation": return verifyCompensationCompleted(receipt, record);
    case "expire-compensation": case "declare-unresolved": return verifyCompensationUnresolved(receipt, record);
    case "expire-workflow": case "cancel-before-execution": return verifyWorkflowFinalized(receipt, record);
  }
}

export async function verifyCurrentState(client: PublicClient, record: PendingTransaction): Promise<VerificationResult> {
  try {
    if (record.action === "create-workflow" && record.workflow) {
      const code = await client.getCode({ address: record.workflow });
      return code && code !== "0x" ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", "Predicted workflow has no runtime code");
    }
    if (record.action === "approve-usdc" && record.expectedEmitter && record.expectedOwner && (record.expectedSpender ?? record.workflow) && record.expectedAmount !== undefined) {
      const allowance = await client.readContract({ address: record.expectedEmitter, abi: erc20Abi, functionName: "allowance", args: [record.expectedOwner, (record.expectedSpender ?? record.workflow)!] });
      return allowance >= record.expectedAmount ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", "Allowance is below the expected amount");
    }
    if (!record.workflow) return fail("STATE_FALLBACK_UNAVAILABLE", "No workflow address is available for state verification");
    if (record.action === "fund-workflow") {
      const deposited = await client.readContract({ address: record.workflow, abi: workflowCoordinatorAbi, functionName: "deposited" });
      return record.expectedAmount !== undefined && deposited === record.expectedAmount ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", "Deposit does not match expected funding");
    }
    if (record.nodeId !== undefined) {
      const bit = 1n << BigInt(record.nodeId);
      if (record.action === "complete-job") return maskState(client, record, "completedMask", bit);
      if (record.action === "reject-job" || record.action === "claim-expiry") return maskState(client, record, "failedMask", bit);
      if (record.action === "complete-compensation") return maskState(client, record, "compensatedMask", bit);
      if (record.action === "expire-compensation" || record.action === "declare-unresolved") return maskState(client, record, "compensationUnresolvedMask", bit);
      const node = await client.readContract({ address: record.workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [record.nodeId] });
      const status = Number(node.status);
      if (record.action === "approve-node") return node.humanApproved ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", "Human approval is not recorded");
      if (record.action === "activate-node") return status >= 2 && node.jobId !== 0n ? stateSuccess(record, node.jobId) : fail("STATE_NOT_VERIFIED", "Node was not activated");
      if (record.action === "submit-job") return status >= 4 ? stateSuccess(record, node.jobId) : fail("STATE_NOT_VERIFIED", "Node is not submitted or later");
      if (record.action === "open-compensation") return status >= 9 && node.jobId !== 0n ? stateSuccess(record, node.jobId) : fail("STATE_NOT_VERIFIED", "Compensation job is not open");
    }
    if (record.action === "expire-workflow" || record.action === "cancel-before-execution") {
      const [finalized, status] = await Promise.all([
        client.readContract({ address: record.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }),
        client.readContract({ address: record.workflow, abi: workflowCoordinatorAbi, functionName: "status" }),
      ]);
      return finalized && (record.expectedFinalStatus === undefined || Number(status) === record.expectedFinalStatus) ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", "Workflow is not finalized in the expected status");
    }
    return fail("STATE_FALLBACK_UNAVAILABLE", `No fallback is defined for ${record.action}`);
  } catch (error) { return fail("STATE_READ_FAILED", error instanceof Error ? error.message : "State verification read failed"); }
}

async function maskState(client: PublicClient, record: PendingTransaction, functionName: "completedMask" | "failedMask" | "compensatedMask" | "compensationUnresolvedMask", bit: bigint): Promise<VerificationResult> {
  const mask = await client.readContract({ address: record.workflow!, abi: workflowCoordinatorAbi, functionName });
  return (BigInt(mask) & bit) !== 0n ? stateSuccess(record) : fail("STATE_NOT_VERIFIED", `${functionName} does not contain the node`);
}
function stateSuccess(record: PendingTransaction, jobId?: bigint): VerificationResult { return { verified: true, eventName: "STATE_VERIFIED", emitter: record.workflow ?? record.expectedEmitter!, ...(record.workflow ? { workflow: record.workflow } : {}), ...(record.nodeId === undefined ? {} : { nodeId: record.nodeId }), ...(jobId === undefined ? {} : { jobId }) }; }
