import type { Metadata } from "next";
import { NetworkNotice } from "@/components/network-notice";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  const { factoryAddress } = publicConfig();
  return (
    <main className="shell page-shell">
      <div className="page-title-row">
        <div><p className="eyebrow">New bounded workflow</p><h1>Compose dependent agent work.</h1><p>Budgets use integer USDC base units. Dependencies are committed and verified again onchain.</p></div>
        <NetworkNotice compact />
      </div>
      <WorkflowBuilder factoryAddress={factoryAddress} />
    </main>
  );
}

