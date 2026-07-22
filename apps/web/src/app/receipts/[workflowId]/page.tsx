import type { Metadata } from "next";
import { optionalAddress } from "@agentsaga/contracts";
import { ReceiptView } from "@/components/receipt-view";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Workflow receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const workflow = optionalAddress(workflowId);
  const { receiptRegistryAddress } = publicConfig();
  return <main className="shell page-shell narrow-shell">{workflow === undefined ? <div className="empty-state error"><h1>Invalid workflow address</h1></div> : <ReceiptView registry={receiptRegistryAddress} workflow={workflow} />}</main>;
}

