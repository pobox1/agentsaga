import { defineChain, getAddress, type Address } from "viem";

export {
  agentJobAdapterAbi,
  compensationTypeLabels,
  nodeStatusLabels,
  policyRegistryAbi,
  receiptRegistryAbi,
  workflowCoordinatorAbi,
  workflowFactoryAbi,
  workflowStatusLabels,
} from "./generated-abis";

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const ARC_TESTNET_USDC = getAddress(
  "0x3600000000000000000000000000000000000000",
);

export const ARC_ERC8004 = {
  identityRegistry: getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
  reputationRegistry: getAddress("0x8004B663056A597Dffe9eCcC1965A193B7388713"),
  validationRegistry: getAddress("0x8004Cb1BF31DAf7788923b405b754f57acEB4272"),
} as const;

// ERC-8004 is an external protocol, so this minimal interface is not generated from project-owned
// artifacts. Registry addresses are verified again against official Arc docs before deployment.
export const erc8004IdentityAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const;

// Payment token calls use the standard external ERC-20 interface.
export const erc20Abi = [
  {
    type: "event",
    name: "Approval",
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function optionalAddress(value: string | undefined): Address | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined;
  return getAddress(value);
}
