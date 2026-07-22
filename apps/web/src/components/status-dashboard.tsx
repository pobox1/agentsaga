"use client";

import { useEffect, useState } from "react";
import { useBlockNumber } from "wagmi";
import { arcTestnet } from "@agentsaga/contracts";

type Probe = { state: "checking" | "ready" | "unavailable"; detail: string };

const configured = {
  factory: Boolean(process.env.NEXT_PUBLIC_WORKFLOW_FACTORY_ADDRESS),
  receiptRegistry: Boolean(process.env.NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS),
  walletConnect: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
  appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
};

export function StatusDashboard() {
  const block = useBlockNumber({ chainId: arcTestnet.id, query: { refetchInterval: 15_000 } });
  const [orchestrator, setOrchestrator] = useState<Probe>({
    state: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ? "checking" : "unavailable",
    detail: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ? "Checking /ready" : "Not configured",
  });

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    if (!base) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6_000);
    fetch(`${base.replace(/\/$/, "")}/ready`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setOrchestrator({ state: "ready", detail: "Ready endpoint responded" });
      })
      .catch((error: unknown) => setOrchestrator({
        state: "unavailable",
        detail: error instanceof Error ? error.message : "Probe failed",
      }))
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const rpcState = block.isSuccess ? "ready" : block.isError ? "unavailable" : "checking";
  return <div className="status-grid">
    <StatusCard label="Arc Testnet RPC" state={rpcState} detail={block.data ? `Latest block ${block.data}` : block.error?.message ?? "Checking chain head"} />
    <StatusCard label="Orchestrator" state={orchestrator.state} detail={orchestrator.detail} />
    <article className="panel"><p className="eyebrow">Public configuration</p><h2>Deployment inputs</h2><div className="proof-fields">
      {Object.entries(configured).map(([name, present]) => <div key={name}><span>{name}</span><code>{present ? "configured" : "missing"}</code></div>)}
    </div></article>
    <article className="panel"><p className="eyebrow">Build identity</p><h2>Release</h2><div className="proof-fields">
      <div><span>Git commit</span><code>{process.env.NEXT_PUBLIC_GIT_COMMIT ?? "not configured"}</code></div>
      <div><span>Chain ID</span><code>{arcTestnet.id}</code></div>
      <div><span>Environment</span><code>{process.env.NEXT_PUBLIC_VERCEL_ENV ?? "local"}</code></div>
    </div></article>
    <article className="panel"><p className="eyebrow">Persistent services</p><h2>Runtime dependencies</h2><div className="proof-fields">
      <div><span>PostgreSQL</span><code>{process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ? "reported by /ready" : "orchestrator not configured"}</code></div>
      <div><span>Redis / BullMQ</span><code>{process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ? "reported by /ready" : "orchestrator not configured"}</code></div>
    </div></article>
    <article className="panel"><p className="eyebrow">External integrations</p><h2>Truthful status</h2><div className="proof-fields">
      <div><span>Circle Agent Wallet</span><code>code integrated · authentication not verified</code></div>
      <div><span>x402</span><code>local deterministic fixture only</code></div>
    </div></article>
  </div>;
}

function StatusCard({ label, state, detail }: { label: string; state: Probe["state"]; detail: string }) {
  return <article className="panel"><p className="eyebrow">Live probe</p><h2>{label}</h2><p><span className={`state state-${state}`}>{state}</span></p><p>{detail}</p></article>;
}
