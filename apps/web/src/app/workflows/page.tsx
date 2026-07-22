import type { Metadata } from "next";
import Link from "next/link";
import { WorkflowList } from "@/components/workflow-list";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  const { factoryAddress } = publicConfig();
  return (
    <main className="shell page-shell">
      <div className="page-title-row"><div><p className="eyebrow">Factory discovery</p><h1>Workflows</h1><p>Coordinator addresses are read from the configured Arc Testnet factory.</p></div><Link className="button button-primary" href="/workflows/new">New workflow</Link></div>
      <WorkflowList factoryAddress={factoryAddress} />
    </main>
  );
}

