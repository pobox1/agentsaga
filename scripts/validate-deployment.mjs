import { readFileSync } from "node:fs";

const file = new URL("../deployments/arc-testnet.json", import.meta.url);
const deployment = JSON.parse(readFileSync(file, "utf8"));
const address = /^0x[0-9a-fA-F]{40}$/;
const hash = /^0x[0-9a-fA-F]{64}$/;
const requiredContracts = ["PolicyRegistry", "WorkflowFactory", "WorkflowReceiptRegistry", "WorkflowCoordinatorImplementation"];

if (deployment.network !== "arc-testnet" || deployment.chainId !== 5_042_002) throw new Error("Deployment network or chain ID is invalid");
if (!address.test(deployment.usdc) || deployment.usdc.toLowerCase() !== "0x3600000000000000000000000000000000000000") throw new Error("Official Arc Testnet USDC address is invalid");
if (!["not-deployed", "deployed"].includes(deployment.status)) throw new Error("Unknown deployment status");
if (deployment.status === "not-deployed") {
  if (Object.keys(deployment.contracts ?? {}).length || deployment.transactions?.length) throw new Error("Undeployed manifest must not contain fabricated contracts or transactions");
} else {
  for (const field of ["deployer", "owner", "treasury"]) if (!address.test(deployment[field])) throw new Error(`Invalid deployed ${field}`);
  for (const name of requiredContracts) if (!address.test(deployment.contracts?.[name])) throw new Error(`Missing deployed ${name}`);
  if (!deployment.transactions?.length || deployment.transactions.some((value) => !hash.test(typeof value === "string" ? value : value.hash))) throw new Error("Deployment transactions are missing or invalid");
  for (const field of ["deploymentBlocks", "sourceVerification", "configuration", "gitCommit", "deploymentDate"]) if (!deployment[field] || (typeof deployment[field] === "object" && !Object.keys(deployment[field]).length)) throw new Error(`Missing deployed ${field}`);
}
console.log(`Arc Testnet deployment manifest is valid (${deployment.status}).`);
