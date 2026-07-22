import type { Metadata } from "next";
import { StatusDashboard } from "@/components/status-dashboard";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return <main className="shell page-shell"><div className="page-title-row"><div><p className="eyebrow">Operational truth</p><h1>System status</h1><p>Live public checks and deployment configuration presence. Values marked missing are not inferred or replaced with placeholders.</p></div></div><StatusDashboard /></main>;
}
