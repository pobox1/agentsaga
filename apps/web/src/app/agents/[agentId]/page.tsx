import type { Metadata } from "next";
import { AgentProfile } from "@/components/agent-profile";

export const metadata: Metadata = { title: "Agent profile" };

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <main className="shell page-shell narrow-shell"><div className="center-heading"><p className="eyebrow">On-chain identity</p><h1>Agent evidence.</h1><p>Direct ERC-8004 registry data from Arc Testnet.</p></div><AgentProfile agentId={agentId} /></main>;
}
