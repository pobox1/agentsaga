"use client";

import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { receiptRegistryAbi, workflowStatusLabels } from "@agentsaga/contracts";

export function ReceiptView({ registry, workflow }: { registry: Address | undefined; workflow: Address }) {
  if (registry === undefined) return <div className="empty-state"><span>NO REGISTRY ADDRESS</span><h2>ReceiptRegistry is not configured.</h2><p>No receipt is inferred from application state.</p></div>;
  return <ConfiguredReceipt registry={registry} workflow={workflow} />;
}

function ConfiguredReceipt({ registry, workflow }: { registry: Address; workflow: Address }) {
  const read = useReadContract({ address: registry, abi: receiptRegistryAbi, functionName: "getReceipt", args: [workflow] });
  if (read.isLoading) return <div className="loading-card">Reading permanent receipt…</div>;
  if (read.error !== null) return <div className="empty-state error"><h2>Receipt read failed.</h2><p>{read.error.message}</p></div>;
  const receipt = read.data;
  if (receipt === undefined || receipt.finalizedBlock === 0n) return <div className="empty-state"><span>NOT FINALIZED</span><h2>No final receipt exists for this workflow.</h2><p>The registry returns an empty record until coordinator finalization.</p></div>;
  const rows = [
    ["Total deposited", receipt.totalDeposited],
    ["Provider payments", receipt.providersPaid],
    ["Compensation spending", receipt.compensationSpent],
    ["Protocol fees", receipt.protocolFees],
    ["Refunded", receipt.refunded],
  ] as const;
  return (
    <article className="receipt-card">
      <div className="receipt-header"><div><p className="eyebrow">Permanent workflow receipt</p><h1>{workflowStatusLabels[receipt.finalStatus] ?? "Unknown"}</h1><code>{workflow}</code></div><div className="receipt-seal">ARC<br />TESTNET</div></div>
      <div className="receipt-money">{rows.map(([label, amount]) => <div key={label}><span>{label}</span><strong>{formatUnits(amount, 6)} <small>USDC</small></strong></div>)}</div>
      <div className="receipt-masks">
        <Mask label="Completed" value={receipt.completedMask} /><Mask label="Failed" value={receipt.failedMask} />
        <Mask label="Skipped" value={receipt.skippedMask} /><Mask label="Compensated" value={receipt.compensatedMask} />
        <Mask label="Unresolved" value={receipt.compensationUnresolvedMask} />
      </div>
      <div className="proof-fields">
        <Proof label="Payment token" value={receipt.paymentToken} />
        <Proof label="DAG specification" value={receipt.dagSpecificationHash} />
        <Proof label="Workflow specification" value={receipt.workflowSpecificationHash} />
        <Proof label="Evidence accumulator" value={receipt.evidenceAccumulator} />
        <Proof label="Execution trace" value={receipt.executionTraceHash} />
      </div>
      <div className="receipt-footer"><span>{receipt.nodeCount} nodes · policy v{receipt.policyVersion.toString()} · deadline {new Date(Number(receipt.globalDeadline) * 1000).toISOString()}</span><span>Created block {receipt.createdBlock.toString()}</span><span>Finalized block {receipt.finalizedBlock.toString()}</span><a href={`https://testnet.arcscan.app/address/${workflow}`} target="_blank" rel="noreferrer">Verify on ArcScan ↗</a></div>
    </article>
  );
}

function Proof({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
function Mask({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><code>0x{value.toString(16).padStart(4, "0")}</code></div>; }
