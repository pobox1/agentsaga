"use client";

import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, keccak256, stringToHex, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { agentJobAdapterAbi, arcTestnet, erc20Abi, workflowCoordinatorAbi } from "@agentsaga/contracts";

const nodeStatus = ["Blocked", "Ready", "Funded", "Submitted", "Completed", "Failed", "Skipped"] as const;

export function WorkflowActions({ workflow, owner, token, adapter, nodeCount, totalBudget, deposited }: {
  workflow: Address; owner: Address | undefined; token: Address | undefined; adapter: Address | undefined; nodeCount: number; totalBudget: bigint; deposited: bigint;
}) {
  const account = useAccount();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const walletClient = useWalletClient();
  const switchChain = useSwitchChain();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const nodes = useReadContracts({
    contracts: Array.from({ length: nodeCount }, (_, nodeId) => ({
      address: workflow, abi: workflowCoordinatorAbi, functionName: "getNode" as const, args: [nodeId],
    })),
  });
  const allowance = useReadContract({
    address: token, abi: erc20Abi, functionName: "allowance",
    args: account.address && token ? [account.address, workflow] : undefined,
    query: { enabled: Boolean(account.address && token) },
  });

  useEffect(() => {
    const recovered = window.localStorage.getItem(`agentsaga:pending:${workflow}`);
    if (recovered) queueMicrotask(() => setMessage(`Recovered pending transaction ${recovered.slice(0, 10)}…`));
  }, [workflow]);

  async function transact(key: string, request: Parameters<NonNullable<typeof publicClient>["simulateContract"]>[0]) {
    if (!account.address || !publicClient || !walletClient.data) throw new Error("Connect a wallet first");
    if (account.chainId !== arcTestnet.id) await switchChain.mutateAsync({ chainId: arcTestnet.id });
    if (await walletClient.data.getChainId() !== arcTestnet.id) throw new Error("Wallet provider is not on Arc Testnet");
    setBusy(key); setMessage(undefined);
    try {
      const simulation = await publicClient.simulateContract({ ...request, account: account.address });
      const hash = await walletClient.data.writeContract(simulation.request);
      window.localStorage.setItem(`agentsaga:pending:${workflow}`, hash);
      setMessage(`Submitted ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      window.localStorage.removeItem(`agentsaga:pending:${workflow}`);
      setMessage(`Confirmed ${hash.slice(0, 10)}…`);
      await Promise.all([nodes.refetch(), allowance.refetch()]);
      return hash;
    } finally { setBusy(undefined); }
  }

  async function approveAndFund() {
    if (!account.address || !token) return setMessage("Connect the owner wallet and configure the payment token.");
    try {
      const current = allowance.data ?? 0n;
      if (current < totalBudget) {
        await transact("approve", { address: token, abi: erc20Abi, functionName: "approve", args: [workflow, totalBudget] });
      }
      await transact("fund", { address: workflow, abi: workflowCoordinatorAbi, functionName: "fund" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  async function coordinatorAction(key: string, functionName: "activateNode" | "approveNode" | "expireWorkflow" | "cancelWorkflow" | "declareCompensationUnresolved" | "openNextCompensation", args?: readonly unknown[]) {
    try { await transact(key, { address: workflow, abi: workflowCoordinatorAbi, functionName, args }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  async function adapterAction(key: string, functionName: "submit" | "complete" | "reject" | "claimRefund", jobId: bigint) {
    if (!adapter) return;
    const args = functionName === "claimRefund" ? [jobId] as const : (() => {
      const evidence = window.prompt(`${functionName}: enter an evidence/reason commitment or source text`);
      if (!evidence) throw new Error("A non-empty commitment is required");
      const commitment = /^0x[a-fA-F0-9]{64}$/.test(evidence) ? evidence as Hash : keccak256(stringToHex(evidence));
      return [jobId, commitment] as const;
    })();
    try { await transact(key, { address: adapter, abi: agentJobAdapterAbi, functionName, args }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed"); }
  }

  const isOwner = account.address?.toLowerCase() === owner?.toLowerCase();
  return <div className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Role-aware operations</p><h2>Nodes and transactions</h2></div></div>
    {deposited === 0n && isOwner && <button className="button button-primary" disabled={Boolean(busy)} onClick={approveAndFund}>
      {busy === "approve" ? "Approving exact budget…" : busy === "fund" ? "Funding…" : `Approve & fund ${formatUnits(totalBudget, 6)} USDC`}
    </button>}
    <div className="node-stack">{nodes.data?.map((result, nodeId) => {
      if (result.status !== "success") return <div className="node-editor" key={nodeId}>Node {nodeId + 1}: RPC read failed</div>;
      const node = result.result;
      const isProvider = account.address?.toLowerCase() === node.provider.toLowerCase();
      const isEvaluator = account.address?.toLowerCase() === node.evaluator.toLowerCase();
      return <div className="node-editor" key={nodeId}>
        <strong>Node {nodeId + 1} · {nodeStatus[node.status] ?? `Unknown (${node.status})`}</strong>
        <dl className="summary-list">
          <div><dt>Provider</dt><dd><code>{node.provider}</code></dd></div><div><dt>Evaluator</dt><dd><code>{node.evaluator}</code></dd></div>
          <div><dt>Budget</dt><dd>{formatUnits(node.budget, 6)} USDC</dd></div><div><dt>Compensation</dt><dd>{formatUnits(node.compensationBudget, 6)} USDC · type {node.compensationType}</dd></div>
          <div><dt>Dependencies</dt><dd>0x{node.dependencyMask.toString(16).padStart(4, "0")}</dd></div><div><dt>Job</dt><dd>{node.jobId.toString()}</dd></div>
          <div><dt>Expiry</dt><dd>{new Date(Number(node.expiry) * 1000).toISOString()}</dd></div><div><dt>Human approval</dt><dd>{node.humanApprovalRequired ? node.humanApproved ? "Approved" : "Required" : "Not required"}</dd></div>
        </dl>
        <Proof label="Specification" value={node.specificationHash} /><Proof label="Metadata" value={node.metadataURI} />
        <div className="action-row">
          <button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction(`activate-${nodeId}`, "activateNode", [nodeId])}>Activate</button>
          {isOwner && node.humanApprovalRequired && <button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction(`approve-${nodeId}`, "approveNode", [nodeId])}>Approve node</button>}
          {isProvider && <button type="button" disabled={Boolean(busy)} onClick={() => adapterAction(`submit-${nodeId}`, "submit", node.jobId)}>Submit commitment</button>}
          {isEvaluator && <><button type="button" disabled={Boolean(busy)} onClick={() => adapterAction(`complete-${nodeId}`, "complete", node.jobId)}>Complete</button><button type="button" disabled={Boolean(busy)} onClick={() => adapterAction(`reject-${nodeId}`, "reject", node.jobId)}>Reject</button></>}
          <button type="button" disabled={Boolean(busy)} onClick={() => adapterAction(`refund-${nodeId}`, "claimRefund", node.jobId)}>Claim expiry refund</button>
          {isOwner && node.compensationType === 1 && <button type="button" disabled={Boolean(busy)} onClick={() => {
            const provider = window.prompt("Compensation provider address"); const evaluator = window.prompt("Compensation evaluator address");
            if (!provider || !evaluator || !isAddress(provider) || !isAddress(evaluator)) return setMessage("Valid compensation provider and evaluator addresses are required");
            void coordinatorAction(`compensate-${nodeId}`, "openNextCompensation", [nodeId, getAddress(provider), getAddress(evaluator), Math.floor(Date.now() / 1_000) + 86_400]);
          }}>Open remediation job</button>}
          {isOwner && node.compensationType === 2 && <button type="button" disabled={Boolean(busy)} onClick={() => {
            const evidence = window.prompt("Enter manual-recovery evidence hash or text");
            if (!evidence) return;
            const commitment = /^0x[a-fA-F0-9]{64}$/.test(evidence) ? evidence as Hash : keccak256(stringToHex(evidence));
            void coordinatorAction(`unresolved-${nodeId}`, "declareCompensationUnresolved", [nodeId, commitment]);
          }}>Declare manual recovery unresolved</button>}
        </div>
      </div>;
    })}</div>
    <div className="action-row">{isOwner && <button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction("cancel", "cancelWorkflow")}>Cancel before execution</button>}<button type="button" disabled={Boolean(busy)} onClick={() => coordinatorAction("expire", "expireWorkflow")}>Expire workflow</button></div>
    {message && <p className="form-message">{message}</p>}
  </div>;
}

function Proof({ label, value }: { label: string; value: string }) { return <div className="proof-fields"><span>{label}</span><code>{value}</code></div>; }
