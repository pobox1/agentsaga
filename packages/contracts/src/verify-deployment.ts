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
const [linkedPolicy, linkedReceipt, implementation, owner, treasury, paused, version, usdcAllowed] = await Promise.all([
  client.readContract({ address: factory, abi: factoryPolicyAbi, functionName: "policyRegistry" }),
  client.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "receiptRegistry" }),
  client.readContract({ address: factory, abi: factoryPolicyAbi, functionName: "workflowImplementation" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "owner" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "treasury" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "paused" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "version" }),
  client.readContract({ address: policy, abi: policyAbi, functionName: "allowedPaymentToken", args: [ARC_TESTNET_USDC] }),
]);
if ((await client.getCode({ address: implementation })) === undefined || linkedPolicy !== policy || linkedReceipt !== receiptRegistry || owner !== expectedOwner || treasury !== expectedTreasury || paused || version < 1n || !usdcAllowed) {
  throw new Error("Deployment configuration verification failed");
}
console.log(JSON.stringify({ chainId: arcTestnet.id, policy, factory, receiptRegistry, implementation, owner, treasury, paused, version: version.toString(), usdc: ARC_TESTNET_USDC }, null, 2));
