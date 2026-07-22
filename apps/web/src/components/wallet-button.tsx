"use client";

import { useState } from "react";
import { arcTestnet } from "@agentsaga/contracts";
import { useAccount, useConnect, useDisconnect, useReconnect, useSwitchChain } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const [chooserOpen, setChooserOpen] = useState(false);
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const reconnect = useReconnect();
  const switchChain = useSwitchChain();

  if (!account.isConnected) {
    return (
      <div className="wallet-chooser">
        <button className="button button-quiet" type="button" onClick={() => setChooserOpen((open) => !open)} disabled={connect.isPending}>
          {connect.isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {chooserOpen && (
          <div className="wallet-menu" role="dialog" aria-label="Choose a wallet">
            {connect.connectors.map((connector) => (
              <button key={connector.uid} type="button" onClick={() => connect.mutate(
                { connector, chainId: arcTestnet.id },
                { onSuccess: () => setChooserOpen(false) },
              )}>
                {connector.name}
              </button>
            ))}
            {connect.connectors.length === 0 && <p>No compatible wallet was detected.</p>}
            {connect.error && (
              <>
                <p role="alert">Connection was rejected or failed. You can retry safely.</p>
                <button type="button" onClick={() => reconnect.mutate()}>Retry previous wallet</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
  if (account.chainId !== arcTestnet.id) {
    return (
      <button className="button button-warning" type="button" onClick={() => switchChain.mutate({ chainId: arcTestnet.id })} disabled={switchChain.isPending}>
        {switchChain.isPending ? "Switching…" : "Add or switch to Arc Testnet"}
      </button>
    );
  }
  return (
    <button className="wallet-pill" type="button" onClick={() => disconnect.mutate()}>
      <span className="network-dot" aria-hidden="true" />
      {account.address === undefined ? "Connected" : shortAddress(account.address)} · disconnect
    </button>
  );
}
