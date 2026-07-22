import type { Metadata } from "next";
import { AgentRegistry } from "../../components/agent-registry";

export const metadata: Metadata = { title: "Agents" };

const agents = [
  ["ResearchAgent", "vendor-research · x402-data", "Deterministic + HTTP/MCP adapters"],
  ["DocumentAgent", "document-validation", "Schema-bounded evidence output"],
  ["RiskAgent", "counterparty-risk", "Can deliberately reject the failure fixture"],
  ["PaymentAgent", "payment-approval", "Human or quorum gate required by demo policy"],
  ["AuditAgent", "reconciliation", "Builds final evidence commitments"],
  ["CompensationAgent", "remediation", "Executes a new explicit recovery job"],
] as const;

export default function AgentsPage() {
  return <main className="shell page-shell"><div className="page-title-row"><div><p className="eyebrow">Runtime modules · not marketplace listings</p><h1>Workflow agents</h1><p>These are implemented software adapters, not fabricated people, providers, or reputation claims.</p></div></div><AgentRegistry /><div className="agent-grid">{agents.map(([name, capability, trust]) => <article className="agent-card" key={name}><div className="agent-glyph">{name.slice(0, 2).toUpperCase()}</div><div><h2>{name}</h2><code>{capability}</code><p>{trust}</p></div><span className="state state-local">Local deterministic</span></article>)}</div></main>;
}
