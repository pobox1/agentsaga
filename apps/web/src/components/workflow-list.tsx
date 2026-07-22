"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { arcTestnet, workflowCoordinatorAbi, workflowFactoryAbi, workflowStatusLabels } from "@agentsaga/contracts";

const pageSize = 20n;
const terminal = new Set([5, 6, 7, 8]);
type Filter = "all" | "mine" | "active" | "compensating" | "completed" | "failed" | "expired";

export function WorkflowList({ factoryAddress }: { factoryAddress: Address | undefined }) {
  if (factoryAddress === undefined) return <div className="empty-state"><span>NO DEPLOYMENT</span><h2>WorkflowFactory is not configured.</h2><p>Local contracts and tests are available, but no Arc Testnet address has been published. No workflows are fabricated.</p><Link className="button button-primary" href="/proof">Open proof of build</Link></div>;
  return <ConfiguredWorkflowList factoryAddress={factoryAddress} />;
}

function ConfiguredWorkflowList({ factoryAddress }: { factoryAddress: Address }) {
  const [page, setPage] = useState(0n); const [filter, setFilter] = useState<Filter>("all"); const account = useAccount();
  const count = useReadContract({ address: factoryAddress, abi: workflowFactoryAbi, functionName: "workflowCount" });
  const workflowCount = count.data ?? 0n; const start = page * pageSize; const end = start + pageSize > workflowCount ? workflowCount : start + pageSize;
  const addressCalls = Array.from({ length: Number(end - start) }, (_, offset) => ({ address: factoryAddress, abi: workflowFactoryAbi, functionName: "workflowById" as const, args: [start + BigInt(offset)] as const }));
  const addressReads = useReadContracts({ contracts: addressCalls, query: { enabled: addressCalls.length > 0 } });
  const addresses = addressReads.data?.map((result) => result.status === "success" ? result.result as Address : undefined) ?? [];
  const detailCalls = addresses.flatMap((address) => address ? (["owner", "status", "totalBudget", "nodeCount", "finalized"] as const).map((functionName) => ({ address, abi: workflowCoordinatorAbi, functionName })) : []);
  const details = useReadContracts({ contracts: detailCalls, query: { enabled: detailCalls.length > 0 } });

  if (count.isLoading) return <div className="loading-card">Reading Arc Testnet...</div>;
  if (count.error) return <div className="empty-state error"><h2>RPC read failed.</h2><p>{count.error.message}</p></div>;
  if (workflowCount === 0n) return <div className="empty-state"><span>0 WORKFLOWS</span><h2>No onchain workflows yet.</h2><p>Create the first funded workflow; this page only lists factory state.</p><Link className="button button-primary" href="/workflows/new">Create workflow</Link></div>;

  const rows = addresses.map((address, index) => {
    const values = details.data?.slice(index * 5, index * 5 + 5); const ok = (position: number) => values?.[position]?.status === "success" ? values[position].result : undefined;
    return { id: start + BigInt(index), address, owner: ok(0) as Address | undefined, status: Number(ok(1) ?? -1), budget: ok(2) as bigint | undefined, nodes: ok(3) as number | undefined, finalized: ok(4) as boolean | undefined };
  }).filter((row) => {
    if (filter === "mine") return Boolean(account.address && row.owner?.toLowerCase() === account.address.toLowerCase());
    if (filter === "active") return row.status >= 0 && !terminal.has(row.status) && row.status !== 4;
    if (filter === "compensating") return row.status === 4;
    if (filter === "completed") return row.status === 5;
    if (filter === "failed") return row.status === 6;
    if (filter === "expired") return row.status === 8;
    return true;
  });
  return <section><div className="workflow-filters" aria-label="Workflow filters">{(["all", "mine", "active", "compensating", "completed", "failed", "expired"] as Filter[]).map((value) => <button className={filter === value ? "button button-primary" : "button button-quiet"} type="button" key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <div className="workflow-card-grid">{rows.map((row) => <article className="panel" key={row.id.toString()}><p className="eyebrow">Workflow #{row.id.toString()}</p><h2>{row.status >= 0 ? workflowStatusLabels[row.status] ?? `Unknown ${row.status}` : "RPC unavailable"}</h2><div className="proof-fields"><Field label="Coordinator" value={row.address ?? "unavailable"} /><Field label="Owner" value={row.owner ?? "unavailable"} /><Field label="Total budget (base units)" value={row.budget?.toString() ?? "unavailable"} /><Field label="Nodes" value={row.nodes?.toString() ?? "unavailable"} /><Field label="Finalized" value={row.finalized === undefined ? "unavailable" : String(row.finalized)} /><Field label="Created block" value="not exposed by coordinator getter" /></div><p className="card-links">{row.address && <><Link href={`/workflows/${row.address}`}>Inspect</Link><Link href={`/receipts/${row.address}`}>Receipt</Link><a href={`${arcTestnet.blockExplorers.default.url}/address/${row.address}`} target="_blank" rel="noreferrer">ArcScan</a></>}</p></article>)}</div>
    {rows.length === 0 && <div className="empty-state"><h2>No workflows match this filter.</h2></div>}
    <div className="pagination"><button className="button button-quiet" type="button" disabled={page === 0n} onClick={() => setPage((value) => value - 1n)}>Previous</button><span>Page {(page + 1n).toString()} of {((workflowCount + pageSize - 1n) / pageSize).toString()}</span><button className="button button-quiet" type="button" disabled={end >= workflowCount} onClick={() => setPage((value) => value + 1n)}>Next</button></div>
  </section>;
}

function Field({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
