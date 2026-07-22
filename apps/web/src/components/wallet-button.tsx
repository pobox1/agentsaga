"use client";

import { arcTestnet } from "@agentsaga/contracts";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();

  if (!account.isConnected) {
    return (
      <button
        className="button button-quiet"
        type="button"
        onClick={() => {
          const connector = connect.connectors[0];
          if (connector !== undefined) connect.mutate({ connector, chainId: arcTestnet.id });
        }}
        disabled={connect.isPending}
      >
        {connect.isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  if (account.chainId !== arcTestnet.id) {
    return (
      <button
        className="button button-warning"
        type="button"
        onClick={() => switchChain.mutate({ chainId: arcTestnet.id })}
      >
        Switch to Arc Testnet
      </button>
    );
  }
  return (
    <button className="wallet-pill" type="button" onClick={() => disconnect.mutate()}>
      <span className="network-dot" aria-hidden="true" />
      {account.address === undefined ? "Connected" : shortAddress(account.address)}
    </button>
  );
}

