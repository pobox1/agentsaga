import Link from "next/link";
import { WalletButton } from "./wallet-button";

const links = [
  ["Workflows", "/workflows"],
  ["Agents", "/agents"],
  ["Receipts", "/receipts"],
  ["Proof", "/proof"],
  ["Docs", "/docs"],
  ["Status", "/status"],
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="AgentSaga home">
          <span className="brand-mark" aria-hidden="true">AS</span>
          <span>AgentSaga</span>
        </Link>
        <nav aria-label="Primary navigation">
          {links.map(([label, href]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
