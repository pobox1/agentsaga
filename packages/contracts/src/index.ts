import { defineChain, getAddress, type Address } from "viem";

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

export const workflowFactoryAbi = [
  {
    type: "function",
    name: "workflowCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "workflowById",
    stateMutability: "view",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [{ name: "workflow", type: "address" }],
  },
  {
    type: "function",
    name: "receiptRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "createWorkflow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "executionBudget", type: "uint96" },
      { name: "compensationReserve", type: "uint96" },
      { name: "deadline", type: "uint48" },
      { name: "dagSpecificationHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "userSalt", type: "bytes32" },
      {
        name: "nodes",
        type: "tuple[]",
        components: [
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "budget", type: "uint96" },
          { name: "compensationBudget", type: "uint96" },
          { name: "expiry", type: "uint48" },
          { name: "dependencyMask", type: "uint16" },
          { name: "specificationHash", type: "bytes32" },
          { name: "compensationSpecificationHash", type: "bytes32" },
          { name: "compensationType", type: "uint8" },
          { name: "humanApprovalRequired", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
    outputs: [
      { name: "workflowId", type: "uint256" },
      { name: "workflow", type: "address" },
    ],
  },
  {
    type: "event",
    name: "WorkflowCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "workflowId", type: "uint256" },
      { indexed: true, name: "workflow", type: "address" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "workflowSpecificationHash", type: "bytes32" },
      { indexed: false, name: "salt", type: "bytes32" },
    ],
  },
] as const;

export const workflowReceiptRegistryEventAbi = [
  {
    type: "event",
    name: "WorkflowReceiptFinalized",
    anonymous: false,
    inputs: [
      { indexed: true, name: "workflow", type: "address" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "finalStatus", type: "uint8" },
      { indexed: false, name: "finalEvidenceRoot", type: "bytes32" },
    ],
  },
] as const;

export const workflowCoordinatorAbi = [
  ...(["owner", "paymentToken", "jobAdapter"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "address" as const }],
  })),
  ...([
    "totalBudget",
    "executionBudget",
    "configuredCompensationReserve",
    "deposited",
    "available",
    "reservedForJobs",
    "reservedForCompensation",
    "paidToProviders",
    "compensationSpent",
    "refunded",
    "protocolFees",
  ] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint96" as const }],
  })),
  ...(["completedMask", "failedMask", "skippedMask", "compensatedMask"] as const).map(
    (name) => ({
      type: "function" as const,
      name,
      stateMutability: "view" as const,
      inputs: [],
      outputs: [{ name: "", type: "uint16" as const }],
    }),
  ),
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "nodeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "workflowSpecificationHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "evidenceAccumulator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "executionTraceHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "activateNode",
    stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "approveNode",
    stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "uint8" }],
    outputs: [],
  },
] as const;

export const receiptRegistryAbi = [
  {
    type: "function",
    name: "getReceipt",
    stateMutability: "view",
    inputs: [{ name: "workflow", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "workflow", type: "address" },
          { name: "owner", type: "address" },
          { name: "totalDeposited", type: "uint96" },
          { name: "providersPaid", type: "uint96" },
          { name: "compensationSpent", type: "uint96" },
          { name: "protocolFees", type: "uint96" },
          { name: "refunded", type: "uint96" },
          { name: "completedMask", type: "uint16" },
          { name: "failedMask", type: "uint16" },
          { name: "compensatedMask", type: "uint16" },
          { name: "finalStatus", type: "uint8" },
          { name: "createdBlock", type: "uint64" },
          { name: "finalizedBlock", type: "uint64" },
          { name: "workflowSpecificationHash", type: "bytes32" },
          { name: "finalEvidenceRoot", type: "bytes32" },
          { name: "executionTraceHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export const workflowStatusLabels = [
  "Draft",
  "Funded",
  "Active",
  "Partially completed",
  "Compensating",
  "Completed",
  "Failed",
  "Cancelled",
  "Expired",
] as const;

export function optionalAddress(value: string | undefined): Address | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined;
  return getAddress(value);
}
