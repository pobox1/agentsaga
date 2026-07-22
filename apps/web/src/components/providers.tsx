"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { useState, type ReactNode } from "react";
import { arcTestnet } from "@agentsaga/contracts";
import { TransactionCenter } from "./transaction-center";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(() => {
    const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    const connectors = [
      injected({ target: "metaMask" }),
      injected({ target: "rabby" }),
      injected(),
      ...(walletConnectProjectId
        ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
        : []),
    ];
    return createConfig({
      chains: [arcTestnet],
      connectors,
      transports: {
        [arcTestnet.id]: http(
          process.env.NEXT_PUBLIC_ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0],
        ),
      },
      ssr: true,
    });
  });
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}<TransactionCenter /></QueryClientProvider>
    </WagmiProvider>
  );
}
