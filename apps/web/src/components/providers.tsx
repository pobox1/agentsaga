"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { useState, type ReactNode } from "react";
import { arcTestnet } from "@agentsaga/contracts";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(() =>
    createConfig({
      chains: [arcTestnet],
      connectors: [injected()],
      transports: {
        [arcTestnet.id]: http(
          process.env.NEXT_PUBLIC_ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0],
        ),
      },
      ssr: true,
    }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

