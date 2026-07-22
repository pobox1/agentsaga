"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { ARC_ERC8004, arcTestnet, erc8004IdentityAbi } from "@agentsaga/contracts";

export function AgentRegistry() {
  const [agentId, setAgentId] = useState("1");
  const [metadataUri, setMetadataUri] = useState("");
  const [message, setMessage] = useState<string>();
  const id = /^\d+$/.test(agentId) ? BigInt(agentId) : 0n;
  const reads = useReadContracts({ contracts: [
    { address: ARC_ERC8004.identityRegistry, abi: erc8004IdentityAbi, functionName: "ownerOf", args: [id] },
    { address: ARC_ERC8004.identityRegistry, abi: erc8004IdentityAbi, functionName: "tokenURI", args: [id] },
  ], query: { enabled: id > 0n } });
  const account = useAccount(); const publicClient = usePublicClient({ chainId: arcTestnet.id }); const wallet = useWalletClient(); const switchChain = useSwitchChain();
  async function register() {
    try {
      if (!account.address || !publicClient || !wallet.data) throw new Error("Connect a wallet first");
      if (!metadataUri || metadataUri.length > 2_048) throw new Error("Enter a metadata URI up to 2048 bytes");
      if (account.chainId !== arcTestnet.id) await switchChain.mutateAsync({ chainId: arcTestnet.id });
      const simulation = await publicClient.simulateContract({ account: account.address, address: ARC_ERC8004.identityRegistry, abi: erc8004IdentityAbi, functionName: "register", args: [metadataUri] });
      const hash = await wallet.data.writeContract(simulation.request); setMessage(`Submitted ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash }); setMessage(`Registered. Verify transaction ${hash} on ArcScan.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Registration failed"); }
  }
  const owner = reads.data?.[0]?.status === "success" ? reads.data[0].result : undefined;
  const uri = reads.data?.[1]?.status === "success" ? reads.data[1].result : undefined;
  return <section className="panel"><p className="eyebrow">Official Arc Testnet ERC-8004 Identity Registry</p><h2>Inspect or register an agent</h2>
    <label>Agent ID<input value={agentId} onChange={(event) => setAgentId(event.target.value)} inputMode="numeric" /></label>
    {owner && <div className="proof-fields"><Proof label="Verified onchain owner" value={owner} /><Proof label="Metadata URI" value={uri ?? ""} /></div>}
    <p>Capabilities, endpoints, validation records, and reputation references belong in the metadata document. Reputation is displayed as evidence, never automatically trusted.</p>
    <label>New agent metadata URI<input value={metadataUri} onChange={(event) => setMetadataUri(event.target.value)} placeholder="ipfs://… or https://…" /></label>
    <button className="button button-primary" type="button" onClick={register}>Register with connected wallet</button>
    {message && <p className="form-message">{message}</p>}
  </section>;
}
function Proof({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><code>{value}</code></div>; }
