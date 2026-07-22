import type { Metadata } from "next";
import { optionalAddress } from "@agentsaga/contracts";
import { WorkflowDetail } from "@/components/workflow-detail";

export const metadata: Metadata = { title: "Workflow detail" };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const address = optionalAddress(workflowId);
  return <main className="shell page-shell">{address === undefined ? <div className="empty-state error"><h1>Invalid workflow address</h1><p>Use the coordinator’s 0x-prefixed EVM address.</p></div> : <WorkflowDetail address={address} />}</main>;
}

