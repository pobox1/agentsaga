export function NetworkNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "network-notice compact" : "network-notice"} role="note">
      <span className="network-dot" aria-hidden="true" />
      Arc Testnet · chain 5,042,002 · testnet USDC only
    </div>
  );
}

