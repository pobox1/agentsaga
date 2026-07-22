import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Protocol docs" };

const docs = [
  ["Architecture", "Coordinator, adapter, vault accounting and receipt boundaries"],
  ["Workflow state machine", "Onchain transitions and terminal conditions"],
  ["Compensation model", "Why remediation is not reversal"],
  ["ERC-8183 integration", "Observable job semantics and bounded deviations"],
  ["Circle Agent Stack", "Wallet, CLI and nanopayment integration status"],
  ["Known limitations", "Testnet, audit and external-service constraints"],
] as const;

export default function DocsPage() {
  return <main className="shell page-shell"><div className="page-title-row"><div><p className="eyebrow">Protocol reference</p><h1>Build and verify AgentSaga.</h1><p>The repository Markdown files are normative for the current MVP.</p></div></div><div className="docs-grid">{docs.map(([name, description], index) => <article className="doc-card" key={name}><span>{String(index + 1).padStart(2, "0")}</span><h2>{name}</h2><p>{description}</p><code>docs/{name.toUpperCase().replaceAll(" ", "_").replaceAll("-", "")}.md</code></article>)}</div><div className="honesty-callout"><strong>Developer entrypoints</strong><p>Run <code>forge test</code> for protocol safety, <code>pnpm test</code> for the engine, and <code>pnpm dev</code> for this interface. Deployment requires an operator-controlled Arc Testnet account.</p><Link href="/proof">Review evidence status →</Link></div></main>;
}

