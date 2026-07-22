"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { formatUnits, getAddress, isAddress, keccak256, stringToHex, type Address, type ContractFunctionReturnType, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { agentJobAdapterAbi, arcTestnet, erc20Abi, nodeStatusLabels, workflowCoordinatorAbi } from "@agentsaga/contracts";
import { recoverPendingTransaction, trackPendingTransaction, type PendingTransaction, type TransactionAction } from "../lib/transactions";

type Dialog =
  | { kind: "commitment"; key: string; functionName: "submit" | "complete" | "reject"; jobId: bigint; nodeId: number; compensation: boolean }
  | { kind: "manual"; nodeId: number }
  | { kind: "remediation"; nodeId: number };

const commitment = (value: string): Hash => /^0x[a-fA-F0-9]{64}$/.test(value)
  ? value as Hash
  : keccak256(stringToHex(value));
const subscribeClock = (callback: () => void) => {
  const timer = window.setInterval(callback, 1_000);
  return () => window.clearInterval(timer);
};
const nowSeconds = () => Math.floor(Date.now() / 1_000);

export function WorkflowActions({ workflow, owner, token, adapter, nodeCount, totalBudget, deposited }: {
  workflow: Address; owner: Address | undefined; token: Address | undefined; adapter: Address | undefined; nodeCount: number; totalBudget: bigint; deposited: bigint;
}) {
  const account = useAccount();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const walletClient = useWalletClient();
  const switchChain = useSwitchChain();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const nodes = useReadContracts({ contracts: Array.from({ length: nodeCount }, (_, nodeId) => ({ address: workflow, abi: workflowCoordinatorAbi, functionName: "getNode" as const, args: [nodeId] })) });
  const pendingCompensation = useReadContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" });
  const allowance = useReadContract({ address: token, abi: erc20Abi, functionName: "allowance", args: account.address && token ? [account.address, workflow] : undefined, query: { enabled: Boolean(account.address && token) } });

  async function transact(key: string, request: Parameters<NonNullable<typeof publicClient>["simulateContract"]>[0], details: { action: TransactionAction; expectedEvent: string; nodeId?: number | undefined; expectedAmount?: bigint | undefined }) {
    if (!account.address || !publicClient || !walletClient.data) throw new Error("Connect a wallet first");
    if (account.chainId !== arcTestnet.id) await switchChain.mutateAsync({ chainId: arcTestnet.id });
    if (await walletClient.data.getChainId() !== arcTestnet.id) throw new Error("Wallet provider is not on Arc Testnet");
    setBusy(key); setMessage(undefined);
    try {
      const simulation = await publicClient.simulateContract({ ...request, account: account.address });
      const hash = await walletClient.data.writeContract(simulation.request);
      const pending: PendingTransaction = { version: 1, action: details.action, chainId: arcTestnet.id, hash, workflow, nodeId: details.nodeId, createdAt: new Date().toISOString(), expectedEvent: details.expectedEvent, expectedOwner: account.address, expectedAmount: details.expectedAmount?.toString(), from: account.address };
      trackPendingTransaction(pending);
      setMessage(`Submitted ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      const recovered = await recoverPendingTransaction(publicClient, pending);
      if (recovered.status !== "Confirmed") throw new Error(recovered.error ?? recovered.status);
      setMessage(`Confirmed ${hash.slice(0, 10)}…`);
      await Promise.all([nodes.refetch(), allowance.refetch(), pendingCompensation.refetch()]);
    } finally { setBusy(undefined); }
  }

  async function approveAndFund() {
    if (!account.address || !token) return setMessage("Connect the owner wallet and configure the payment token.");
    try {
      if ((allowance.data ?? 0n) < totalBudget) await transact("approve", { address: token, abi: erc20Abi, functionName: "approve", args: [workflow, totalBudget] }, { action: "approve-usdc", expectedEvent: "Approval", expectedAmount: totalBudget });
      await transact("fund", { address: workflow, abi: workflowCoordinatorAbi, functionName: "fund" }, { action: "fund-workflow", expectedEvent: "WorkflowFunded", expectedAmount: totalBudget });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  async function coordinatorAction(key: string, functionName: "activateNode" | "approveNode" | "expireWorkflow" | "cancelBeforeExecution" | "expireCompensation" | "declareCompensationUnresolved" | "openNextCompensation", args?: readonly unknown[]) {
    const metadata: Record<typeof functionName, { action: TransactionAction; expectedEvent: string }> = {
      activateNode: { action: "activate-node", expectedEvent: "NodeActivated" }, approveNode: { action: "approve-node", expectedEvent: "NodeApproved" },
      expireWorkflow: { action: "expire-workflow", expectedEvent: "WorkflowStatusChanged" }, cancelBeforeExecution: { action: "cancel-before-execution", expectedEvent: "WorkflowStatusChanged" },
      expireCompensation: { action: "expire-compensation", expectedEvent: "CompensationUnresolved" }, declareCompensationUnresolved: { action: "declare-unresolved", expectedEvent: "CompensationUnresolved" },
      openNextCompensation: { action: "open-compensation", expectedEvent: "CompensationJobOpened" },
    };
    try { await transact(key, { address: workflow, abi: workflowCoordinatorAbi, functionName, args }, { ...metadata[functionName], nodeId: typeof args?.[0] === "number" ? args[0] : undefined }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  async function adapterAction(dialogValue: Extract<Dialog, { kind: "commitment" }>, value: string) {
    if (!adapter || !value.trim()) throw new Error("A non-empty commitment is required");
    const action = dialogValue.functionName === "submit" ? "submit-job" : dialogValue.functionName === "complete" ? (dialogValue.compensation ? "complete-compensation" : "complete-job") : "reject-job";
    const expectedEvent = dialogValue.functionName === "submit" ? "JobSubmitted" : dialogValue.functionName === "complete" ? "JobCompleted" : "JobRejected";
    await transact(dialogValue.key, { address: adapter, abi: agentJobAdapterAbi, functionName: dialogValue.functionName, args: [dialogValue.jobId, commitment(value)] }, { action, expectedEvent, nodeId: dialogValue.nodeId });
  }

  async function claimExpiry(jobId: bigint, nodeId: number) {
    if (!adapter) return;
    try { await transact(`refund-${nodeId}`, { address: adapter, abi: agentJobAdapterAbi, functionName: "claimRefund", args: [jobId] }, { action: "claim-expiry", expectedEvent: "JobExpired", nodeId }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  const isOwner = account.address?.toLowerCase() === owner?.toLowerCase();
  const pendingMask = Number(pendingCompensation.data ?? 0);
  const highestPending = pendingMask === 0 ? -1 : 31 - Math.clz32(pendingMask);
  return <div className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Role-aware operations</p><h2>Nodes and transactions</h2></div></div>
    {deposited === 0n && isOwner && <button className="button button-primary" disabled={Boolean(busy)} onClick={approveAndFund}>{busy === "approve" ? "Approving exact budget…" : busy === "fund" ? "Funding…" : `Approve & fund ${formatUnits(totalBudget, 6)} USDC`}</button>}
    <div className="node-stack">{nodes.data?.map((result, nodeId) => result.status === "success" ? <NodeCard key={nodeId} nodeId={nodeId} node={result.result} account={account.address} owner={isOwner} adapter={adapter} busy={Boolean(busy)} compensationPending={nodeId === highestPending} setDialog={setDialog} coordinatorAction={coordinatorAction} claimExpiry={claimExpiry} /> : <div className="node-editor" key={nodeId}>Node {nodeId + 1}: RPC read failed</div>)}</div>
    <div className="action-row">{isOwner && <button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction("cancel", "cancelBeforeExecution")}>Cancel before execution</button>}<button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction("expire", "expireWorkflow")}>Expire workflow</button></div>
    {message && <p className="form-message">{message}</p>}
    {dialog && <ActionDialog dialog={dialog} close={() => setDialog(undefined)} submit={async (value) => {
      try {
        if (dialog.kind === "commitment") await adapterAction(dialog, value.raw);
        if (dialog.kind === "manual") await coordinatorAction(`unresolved-${dialog.nodeId}`, "declareCompensationUnresolved", [dialog.nodeId, commitment(value.raw)]);
        if (dialog.kind === "remediation") {
          if (!isAddress(value.provider) || !isAddress(value.evaluator)) throw new Error("Valid provider and evaluator addresses are required");
          await coordinatorAction(`compensate-${dialog.nodeId}`, "openNextCompensation", [dialog.nodeId, getAddress(value.provider), getAddress(value.evaluator), Math.floor(Date.now() / 1_000) + Number(value.deadlineHours) * 3_600]);
        }
        setDialog(undefined);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
    }} />}
  </div>;
}

type NodeValue = ContractFunctionReturnType<typeof workflowCoordinatorAbi, "view", "getNode">;
function NodeCard({ nodeId, node, account, owner, adapter, busy, compensationPending, setDialog, coordinatorAction, claimExpiry }: { nodeId: number; node: NodeValue; account?: Address | undefined; owner: boolean; adapter?: Address | undefined; busy: boolean; compensationPending: boolean; setDialog: (dialog: Dialog) => void; coordinatorAction: (key: string, fn: "activateNode" | "approveNode" | "expireCompensation" | "openNextCompensation", args: readonly unknown[]) => Promise<void>; claimExpiry: (jobId: bigint, nodeId: number) => Promise<void> }) {
  const now = useSyncExternalStore(subscribeClock, nowSeconds, () => 0);
  const compensationJob = useReadContract({ address: adapter, abi: agentJobAdapterAbi, functionName: "getJob", args: [node.jobId], query: { enabled: Boolean(adapter && node.status === 9) } });
  const provider = node.status === 9 && compensationJob.data ? compensationJob.data.provider : node.provider;
  const evaluator = node.status === 9 && compensationJob.data ? compensationJob.data.evaluator : node.evaluator;
  const adapterStatus = node.status === 9 && compensationJob.data ? compensationJob.data.status : undefined;
  const isProvider = account?.toLowerCase() === provider.toLowerCase();
  const isEvaluator = account?.toLowerCase() === evaluator.toLowerCase();
  return <div className="node-editor"><strong>Node {nodeId + 1} · {nodeStatusLabels[node.status] ?? `Unknown (${node.status})`}</strong>
    <dl className="summary-list"><div><dt>Provider</dt><dd><code>{provider}</code></dd></div><div><dt>Evaluator</dt><dd><code>{evaluator}</code></dd></div><div><dt>Budget</dt><dd>{formatUnits(node.budget, 6)} USDC</dd></div><div><dt>Job</dt><dd>{node.jobId.toString()}</dd></div><div><dt>Expiry</dt><dd>{new Date(Number(node.expiry) * 1000).toISOString()}</dd></div></dl>
    <div className="action-row">
      {node.status === 1 && <button type="button" disabled={busy} onClick={() => coordinatorAction(`activate-${nodeId}`, "activateNode", [nodeId])}>Activate</button>}
      {owner && node.humanApprovalRequired && !node.humanApproved && (node.status === 0 || node.status === 1) && <button type="button" disabled={busy} onClick={() => coordinatorAction(`approve-${nodeId}`, "approveNode", [nodeId])}>Approve node</button>}
      {isProvider && (node.status === 2 || node.status === 9 && adapterStatus === 1) && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "commitment", key: `submit-${nodeId}`, functionName: "submit", jobId: node.jobId, nodeId, compensation: node.status === 9 })}>Submit commitment</button>}
      {isEvaluator && (node.status === 4 || node.status === 9 && adapterStatus === 2) && <><button type="button" disabled={busy} onClick={() => setDialog({ kind: "commitment", key: `complete-${nodeId}`, functionName: "complete", jobId: node.jobId, nodeId, compensation: node.status === 9 })}>Complete</button>{node.status !== 9 && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "commitment", key: `reject-${nodeId}`, functionName: "reject", jobId: node.jobId, nodeId, compensation: false })}>Reject</button>}</>}
      {(node.status === 2 || node.status === 4) && now >= Number(node.expiry) && <button type="button" disabled={busy} onClick={() => void claimExpiry(node.jobId, nodeId)}>Claim expiry refund</button>}
      {node.status === 9 && compensationPending && compensationJob.data && now >= Number(compensationJob.data.expiredAt) && <button type="button" disabled={busy} onClick={() => coordinatorAction(`expire-comp-${nodeId}`, "expireCompensation", [nodeId])}>Expire compensation</button>}
      {owner && compensationPending && node.compensationType === 1 && node.status === 5 && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "remediation", nodeId })}>Open remediation job</button>}
      {owner && compensationPending && node.compensationType === 2 && node.status === 5 && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "manual", nodeId })}>Declare manual recovery unresolved</button>}
    </div>
  </div>;
}

function ActionDialog({ dialog, close, submit }: { dialog: Dialog; close: () => void; submit: (value: { raw: string; provider: string; evaluator: string; deadlineHours: string }) => Promise<void> }) {
  const [raw, setRaw] = useState(""); const [provider, setProvider] = useState(""); const [evaluator, setEvaluator] = useState(""); const [deadlineHours, setDeadlineHours] = useState("24");
  const hash = useMemo(() => raw ? commitment(raw) : undefined, [raw]);
  return <div className="modal-backdrop" role="presentation"><div className="panel action-modal" role="dialog" aria-modal="true" aria-labelledby="action-title"><h2 id="action-title">Confirm onchain action</h2>
    {dialog.kind === "remediation" ? <><label>Compensation provider<input value={provider} onChange={(event) => setProvider(event.target.value)} /></label><label>Compensation evaluator<input value={evaluator} onChange={(event) => setEvaluator(event.target.value)} /></label><label>Deadline (hours)<input value={deadlineHours} inputMode="numeric" onChange={(event) => setDeadlineHours(event.target.value)} /></label></> : <><label>Evidence or reason<textarea autoFocus value={raw} onChange={(event) => setRaw(event.target.value)} /></label><p>Only this bytes32 commitment is stored onchain:</p><code>{hash ?? "Enter a value"}</code></>}
    <div className="action-row"><button type="button" onClick={close}>Cancel</button><button type="button" onClick={() => void submit({ raw, provider, evaluator, deadlineHours })}>Simulate and sign</button></div></div></div>;
}
