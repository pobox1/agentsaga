"use client";

import Link from "next/link";
import { formatUnits, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { workflowCoordinatorAbi, workflowStatusLabels } from "@agentsaga/contracts";
import { WorkflowActions } from "./workflow-actions";

const fields = [
  "owner",
  "paymentToken",
  "jobAdapter",
  "status",
  "finalized",
  "activationMask",
  "nodeCount",
  "totalBudget",
  "deposited",
  "available",
  "reservedForJobs",
  "reservedForCompensation",
  "paidToProviders",
  "compensationSpent",
  "refunded",
  "protocolFees",
  "completedMask",
  "failedMask",
  "skippedMask",
  "compensatedMask",
  "compensationUnresolvedMask",
  "workflowSpecificationHash",
  "evidenceAccumulator",
  "executionTraceHash",
] as const;

export function WorkflowDetail({ address }: { address: Address }) {
  const reads = useReadContracts({
    contracts: fields.map((functionName) => ({ address, abi: workflowCoordinatorAbi, functionName })),
  });
  const value = (name: typeof fields[number]) => {
    const index = fields.indexOf(name);
    const result = reads.data?.[index];
    return result?.status === "success" ? result.result : undefined;
  };
  const status = Number(value("status") ?? 0);
  const nodeCount = Number(value("nodeCount") ?? 0);
  const completed = Number(value("completedMask") ?? 0);
  const failed = Number(value("failedMask") ?? 0);
  const skipped = Number(value("skippedMask") ?? 0);
  const compensated = Number(value("compensatedMask") ?? 0);
  const money = (name: typeof fields[number]) => {
    const raw = value(name);
    return typeof raw === "bigint" ? formatUnits(raw, 6) : "—";
  };
  const bigintValue = (name: typeof fields[number]) => {
    const raw = value(name);
    return typeof raw === "bigint" ? raw : 0n;
  };

  if (reads.isLoading) return <div className="loading-card">Reading coordinator state from Arc RPC…</div>;
  if (reads.error !== null) return <div className="empty-state error"><h2>Coordinator read failed.</h2><p>{reads.error.message}</p></div>;

  return (
    <div className="detail-layout">
      <section className="detail-main">
        <div className="panel detail-hero"><div><p className="eyebrow">Workflow coordinator</p><h2>{workflowStatusLabels[status] ?? `Unknown (${status})`}</h2><code>{address}</code></div><span className={`state ${failed > 0 ? "state-failed" : status === 5 ? "state-complete" : "state-active"}`}>{workflowStatusLabels[status] ?? "Unknown"}</span></div>
        <div className="metrics-grid">
          <Metric label="Deposited" value={money("deposited")} />
          <Metric label="Providers paid" value={money("paidToProviders")} />
          <Metric label="Compensation spent" value={money("compensationSpent")} />
          <Metric label="Refunded" value={money("refunded")} />
        </div>
        <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Onchain DAG state</p><h2>Node bitmaps</h2></div><span>{nodeCount} nodes</span></div><div className="bitmap-grid">{Array.from({ length: nodeCount }, (_, id) => {
          const bit = 1 << id;
          const state = (compensated & bit) !== 0 ? "Compensated" : (completed & bit) !== 0 ? "Completed" : (failed & bit) !== 0 ? "Failed" : (skipped & bit) !== 0 ? "Skipped" : "Pending";
          return <div className="bitmap-node" key={id}><span>{String(id + 1).padStart(2, "0")}</span><strong>{state}</strong></div>;
        })}</div></div>
        <div className="panel proof-fields"><h2>Cryptographic commitments</h2><ProofField label="Workflow specification" value={String(value("workflowSpecificationHash") ?? "—")} /><ProofField label="Evidence accumulator" value={String(value("evidenceAccumulator") ?? "—")} /><ProofField label="Execution trace" value={String(value("executionTraceHash") ?? "—")} /></div>
        <WorkflowActions workflow={address} owner={value("owner") as Address | undefined} token={value("paymentToken") as Address | undefined} adapter={value("jobAdapter") as Address | undefined} nodeCount={nodeCount} totalBudget={bigintValue("totalBudget")} deposited={bigintValue("deposited")} status={status} finalized={Boolean(value("finalized"))} activationMask={Number(value("activationMask") ?? 0)} reservedForJobs={bigintValue("reservedForJobs")} />
      </section>
      <aside className="detail-aside"><div className="panel"><p className="eyebrow">Vault liabilities</p><dl className="summary-list"><div><dt>Available</dt><dd>{money("available")}</dd></div><div><dt>Jobs reserved</dt><dd>{money("reservedForJobs")}</dd></div><div><dt>Compensation reserved</dt><dd>{money("reservedForCompensation")}</dd></div><div><dt>Protocol fees</dt><dd>{money("protocolFees")}</dd></div></dl><a className="button button-quiet button-full" href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer">Open in ArcScan</a><Link className="text-link" href={`/receipts/${address}`}>Open final receipt →</Link></div></aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>USDC</small></div>; }
function ProofField({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
