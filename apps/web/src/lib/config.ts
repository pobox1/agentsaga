import { optionalAddress } from "@agentsaga/contracts";

export function publicConfig() {
  return {
    factoryAddress: optionalAddress(process.env.NEXT_PUBLIC_WORKFLOW_FACTORY_ADDRESS),
    receiptRegistryAddress: optionalAddress(
      process.env.NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS,
    ),
    rpcUrl:
      process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
  };
}

