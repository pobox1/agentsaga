"use client";

import Link from "next/link";
import { useReadContracts } from "wagmi";
import { ARC_ERC8004, arcTestnet, erc8004IdentityAbi } from "@agentsaga/contracts";

export function AgentProfile({ agentId }: { agentId: string }) {
  const valid = /^\d+$/.test(agentId) && BigInt(agentId) > 0n;
  const id = valid ? BigInt(agentId) : 0n;
  const reads = useReadContracts({ contracts: [
    { chainId: arcTestnet.id, address: ARC_ERC8004.identityRegistry, abi: erc8004IdentityAbi, functionName: "ownerOf", args: [id] },
    { chainId: arcTestnet.id, address: ARC_ERC8004.identityRegistry, abi: erc8004IdentityAbi, functionName: "tokenURI", args: [id] },
  ], query: { enabled: valid } });
  if (!valid) return <section className="empty-state"><div><h2>Invalid agent ID</h2><p>Agent IDs are positive integers.</p><Link href="/agents">Return to agents</Link></div></section>;
  if (reads.isPending) return <section className="loading-card">Reading ERC-8004 registry...</section>;
  const owner = reads.data?.[0]?.status === "success" ? reads.data[0].result : undefined;
  const uri = reads.data?.[1]?.status === "success" ? reads.data[1].result : undefined;
  const error = reads.data?.find((result) => result.status === "failure");
  return <section className="panel"><p className="eyebrow">Arc Testnet ERC-8004 infrastructure</p><h2>Agent #{agentId}</h2>
    {error || !owner ? <p>Registry lookup failed or this token does not exist. No owner or reputation is inferred.</p> : <div className="proof-fields">
      <Proof label="On-chain owner" value={owner} />
      <Proof label="Metadata URI" value={uri || "empty"} />
      <Proof label="Identity registry" value={ARC_ERC8004.identityRegistry} />
    </div>}
    <p><a href={`${arcTestnet.blockExplorers.default.url}/address/${ARC_ERC8004.identityRegistry}`} target="_blank" rel="noreferrer">Verify registry on ArcScan</a></p>
    <p>Metadata, validation and reputation are evidence sources; this page does not treat them as automatic trust.</p>
  </section>;
}

function Proof({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
