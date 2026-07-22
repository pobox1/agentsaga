"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { workflowFactoryAbi } from "@agentsaga/contracts";

export function WorkflowList({ factoryAddress }: { factoryAddress: Address | undefined }) {
  if (factoryAddress === undefined) {
    return <div className="empty-state"><span>NO DEPLOYMENT</span><h2>WorkflowFactory is not configured.</h2><p>Local contracts and tests are available, but no Arc Testnet address has been published. No workflows are fabricated.</p><Link className="button button-primary" href="/proof">Open proof of build</Link></div>;
  }
  return <ConfiguredWorkflowList factoryAddress={factoryAddress} />;
}

function ConfiguredWorkflowList({ factoryAddress }: { factoryAddress: Address }) {
  const count = useReadContract({
    address: factoryAddress,
    abi: workflowFactoryAbi,
    functionName: "workflowCount",
  });
  const workflowCount = count.data ?? 0n;
  const cappedCount = workflowCount > 100n ? 100n : workflowCount;
  const contracts = Array.from({ length: Number(cappedCount) }, (_, index) => ({
    address: factoryAddress,
    abi: workflowFactoryAbi,
    functionName: "workflowById" as const,
    args: [BigInt(index)] as const,
  }));
  const workflows = useReadContracts({ contracts, query: { enabled: contracts.length > 0 } });

  if (count.isLoading) return <div className="loading-card">Reading Arc Testnet…</div>;
  if (count.error !== null) return <div className="empty-state error"><h2>RPC read failed.</h2><p>{count.error.message}</p></div>;
  if (workflowCount === 0n) return <div className="empty-state"><span>0 WORKFLOWS</span><h2>No onchain workflows yet.</h2><p>Create the first funded workflow; this page only lists factory state.</p><Link className="button button-primary" href="/workflows/new">Create workflow</Link></div>;

  return (
    <div className="workflow-table" role="table" aria-label="Onchain workflows">
      <div className="workflow-table-head" role="row"><span>ID</span><span>Coordinator</span><span>Network</span><span /></div>
      {workflows.data?.map((result, index) => {
        const address = result.status === "success" ? result.result as Address : undefined;
        return (
          <div className="workflow-table-row" role="row" key={index}>
            <strong>#{index}</strong><code>{address ?? "RPC read unavailable"}</code><span className="state state-active">Arc Testnet</span>
            {address === undefined ? <span /> : <Link href={`/workflows/${address}`}>Inspect →</Link>}
          </div>
        );
      })}
    </div>
  );
}

