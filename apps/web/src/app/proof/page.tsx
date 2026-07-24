import type { Metadata } from "next";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Proof of build" };

function EvidenceRow({ label, value, status }: { label: string; value: string; status: "verified" | "local" | "pending" }) {
  return <div className="evidence-row"><span className={`state state-${status}`}>{status}</span><strong>{label}</strong><code>{value}</code></div>;
}

export default function ProofPage() {
  const config = publicConfig();
  return <main className="shell page-shell"><div className="page-title-row"><div><p className="eyebrow">No invented hashes or endorsements</p><h1>Proof of Build</h1><p>Local verification is complete. Testnet claims stay pending until transactions actually exist.</p></div></div><div className="proof-layout"><section className="panel"><h2>Project-owned contracts</h2><EvidenceRow status="local" label="WorkflowFactory" value={config.factoryAddress ?? "compiled + tested; not deployed"} /><EvidenceRow status="local" label="WorkflowCoordinator" value="per-workflow CREATE2 deployment" /><EvidenceRow status="local" label="AgentJobAdapter" value="ERC-8183-equivalent observable lifecycle" /><EvidenceRow status="local" label="ReceiptRegistry" value={config.receiptRegistryAddress ?? "compiled + tested; not deployed"} /><EvidenceRow status="local" label="PolicyRegistry" value="bounded policy; no governance token" /></section><section className="panel"><h2>Public evidence</h2><EvidenceRow status="pending" label="Source verification" value="requires Arc Testnet deployment" /><EvidenceRow status="pending" label="Successful workflow transaction" value="not created" /><EvidenceRow status="pending" label="Failed + compensated workflow" value="not created" /><EvidenceRow status="pending" label="Real x402 nanopayment" value="local fixture only" /><EvidenceRow status="pending" label="Circle Agent Wallet" value="operator authentication not started" /></section></div><div className="honesty-callout"><strong>Current readiness</strong><p>Saga is an independent testnet application built on Arc Network infrastructure. It is not an official Arc or Circle product, externally audited protocol, or endorsed product.</p></div></main>;
}
