import type { Metadata } from "next";
import { ReceiptLookup } from "@/components/receipt-lookup";

export const metadata: Metadata = { title: "Receipts" };

export default function ReceiptsPage() {
  return <main className="shell page-shell narrow-shell"><div className="center-heading"><p className="eyebrow">Public RPC · no private backend</p><h1>Verify a workflow receipt.</h1><p>Enter a coordinator address. AgentSaga reads the permanent receipt from Arc Testnet; missing data stays missing.</p></div><ReceiptLookup /></main>;
}

