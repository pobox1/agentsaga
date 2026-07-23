import { createPublicClient, getAddress, http, isAddress } from "viem";
import { arcTestnet, ARC_TESTNET_USDC, workflowFactoryAbi } from "./index.js";

const policyAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "allowedPaymentToken", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;
const factoryPolicyAbi = [
  { type: "function", name: "policyRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "workflowImplementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const multicall3Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

function requiredAddress(name: string) {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`${name} must be a valid address`);
  return getAddress(value);
}

const factory = requiredAddress("WORKFLOW_FACTORY_ADDRESS");
const policy = requiredAddress("POLICY_REGISTRY_ADDRESS");
const receiptRegistry = requiredAddress("RECEIPT_REGISTRY_ADDRESS");
const expectedOwner = requiredAddress("DEPLOYMENT_OWNER");
const expectedTreasury = requiredAddress("DEPLOYMENT_TREASURY");
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL ?? arcTestnet.rpcUrls.default.http[0]) });

for (const [name, address] of [["policy", policy], ["factory", factory], ["receiptRegistry", receiptRegistry]] as const) {
  if ((await client.getCode({ address })) === undefined) throw new Error(`${name} has no runtime bytecode`);
}
// Arc's public RPC enforces a low request limit. Collapse relationship and
// configuration reads into one Multicall3 eth_call instead of issuing a burst.
const [linkedPolicy, linkedReceipt, implementation, owner, treasury, paused, version, usdcAllowed] = await client.multicall({
  allowFailure: false,
  multicallAddress: multicall3Address,
  contracts: [
    { address: factory, abi: factoryPolicyAbi, functionName: "policyRegistry" },
    { address: factory, abi: workflowFactoryAbi, functionName: "receiptRegistry" },
    { address: factory, abi: factoryPolicyAbi, functionName: "workflowImplementation" },
    { address: policy, abi: policyAbi, functionName: "owner" },
    { address: policy, abi: policyAbi, functionName: "treasury" },
    { address: policy, abi: policyAbi, functionName: "paused" },
    { address: policy, abi: policyAbi, functionName: "version" },
    { address: policy, abi: policyAbi, functionName: "allowedPaymentToken", args: [ARC_TESTNET_USDC] },
  ],
});
if ((await client.getCode({ address: implementation })) === undefined || linkedPolicy !== policy || linkedReceipt !== receiptRegistry || owner !== expectedOwner || treasury !== expectedTreasury || paused || version < 1n || !usdcAllowed) {
  throw new Error("Deployment configuration verification failed");
}
console.log(JSON.stringify({ chainId: arcTestnet.id, policy, factory, receiptRegistry, implementation, owner, treasury, paused, version: version.toString(), usdc: ARC_TESTNET_USDC }, null, 2));
