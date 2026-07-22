import { optionalAddress } from "@agentsaga/contracts";

export function publicConfig() {
  const config = {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    factoryAddress: optionalAddress(process.env.NEXT_PUBLIC_WORKFLOW_FACTORY_ADDRESS),
    receiptRegistryAddress: optionalAddress(
      process.env.NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS,
    ),
    rpcUrl:
      process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  };
  if (process.env.VERCEL_ENV === "production") {
    const missing = [
      ["NEXT_PUBLIC_APP_URL", config.appUrl],
      ["NEXT_PUBLIC_WORKFLOW_FACTORY_ADDRESS", config.factoryAddress],
      ["NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS", config.receiptRegistryAddress],
      ["NEXT_PUBLIC_ARC_RPC_URL", process.env.NEXT_PUBLIC_ARC_RPC_URL],
      ["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", config.walletConnectProjectId],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing production configuration: ${missing.join(", ")}`);
    }
  }
  return config;
}
