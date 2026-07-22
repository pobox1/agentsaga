import Link from "next/link";
import { NetworkNotice } from "@/components/network-notice";

const flow = [
  ["01", "Research", "Paid data and vendor evidence"],
  ["02", "Documents", "Invoice and contract validation"],
  ["03", "Risk", "Counterparty policy decision"],
  ["04", "Payment", "Human-gated USDC execution"],
  ["05", "Audit", "Receipt and reconciliation"],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="hero shell">
        <div className="hero-copy">
          <NetworkNotice compact />
          <p className="eyebrow">Workflow-level financial safety</p>
          <h1>When one agent fails, the money still has to add up.</h1>
          <p className="hero-lede">
            Multi-agent workflows can fail halfway through. AgentSaga keeps their budgets,
            dependencies, payouts, refunds, and compensations consistent on Arc.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/workflows/new">
              Create a testnet workflow
            </Link>
            <Link className="button button-quiet" href="/receipts">
              View verified workflow
            </Link>
          </div>
        </div>
        <div className="hero-ledger" aria-label="Workflow settlement summary">
          <div className="ledger-topline"><span>VENDOR ONBOARDING</span><span>PARTIAL / SAFE</span></div>
          <div className="ledger-amount"><small>Budget envelope</small><strong>500.00</strong><span>USDC</span></div>
          <div className="ledger-row"><span>Valid work paid</span><b>200.00</b></div>
          <div className="ledger-row"><span>Compensation reserved</span><b>50.00</b></div>
          <div className="ledger-row"><span>Unused returned</span><b>250.00</b></div>
          <div className="ledger-rule" />
          <div className="ledger-proof"><span>Every movement</span><b>committed onchain</b></div>
          <p className="fixture-label">Illustrative accounting layout — not transaction evidence</p>
        </div>
      </section>

      <section className="section shell">
        <div className="section-heading">
          <p className="eyebrow">One workflow · five economic actors</p>
          <h2>Dependencies become settlement rules.</h2>
          <p>A completed prerequisite unlocks its child. A failed prerequisite freezes descendants.</p>
        </div>
        <div className="flow-grid">
          {flow.map(([number, title, description], index) => (
            <article className="flow-card" key={title}>
              <div className="flow-index">{number}</div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className={index < 2 ? "state state-complete" : index === 2 ? "state state-failed" : "state state-skipped"}>
                {index < 2 ? "Completed" : index === 2 ? "Rejected" : "Skipped"}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell split-section">
        <div>
          <p className="eyebrow">Refund ≠ rollback ≠ compensation</p>
          <h2>Failure is represented honestly.</h2>
        </div>
        <div className="definition-list">
          <div><strong>Refund</strong><p>Returns USDC that was never earned or no longer needs to remain reserved.</p></div>
          <div><strong>Rollback</strong><p>Only an atomic transaction revert. It cannot undo a completed external action.</p></div>
          <div><strong>Compensation</strong><p>A new funded job that attempts remediation and records whether it succeeded.</p></div>
        </div>
      </section>
    </main>
  );
}

