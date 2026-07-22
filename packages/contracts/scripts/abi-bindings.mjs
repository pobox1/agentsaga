import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const repositoryRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const outputPath = path.join(repositoryRoot, "packages/contracts/src/generated-abis.ts");

const contracts = [
  ["WorkflowFactory", "workflowFactoryAbi"],
  ["WorkflowCoordinator", "workflowCoordinatorAbi"],
  ["AgentJobAdapter", "agentJobAdapterAbi"],
  ["WorkflowReceiptRegistry", "receiptRegistryAbi"],
  ["PolicyRegistry", "policyRegistryAbi"],
];

function parseEnum(source, name) {
  const match = source.match(new RegExp(`enum\\s+${name}\\s*\\{([^}]+)\\}`, "s"));
  if (!match) throw new Error(`Unable to find Solidity enum ${name}`);
  return match[1].split(",").map((item) => item.replace(/\/\/.*$/gm, "").trim()).filter(Boolean);
}

export async function buildGeneratedBindings() {
  const coordinatorSource = await readFile(
    path.join(repositoryRoot, "contracts/src/WorkflowCoordinator.sol"),
    "utf8",
  );
  const sections = [
    "// Generated from Foundry artifacts by packages/contracts/scripts/generate-abi.mjs.",
    "// Do not edit manually. Run `pnpm contracts:generate-abi` after Solidity changes.",
    "",
  ];
  for (const [contractName, exportName] of contracts) {
    const artifactPath = path.join(
      repositoryRoot,
      `out/${contractName}.sol/${contractName}.json`,
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (!Array.isArray(artifact.abi)) throw new Error(`Artifact ABI missing: ${artifactPath}`);
    sections.push(`export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;`, "");
  }
  sections.push(
    `export const workflowStatusLabels = ${JSON.stringify(parseEnum(coordinatorSource, "WorkflowStatus"), null, 2)} as const;`,
    "",
    `export const nodeStatusLabels = ${JSON.stringify(parseEnum(coordinatorSource, "NodeStatus"), null, 2)} as const;`,
    "",
    `export const compensationTypeLabels = ${JSON.stringify(parseEnum(coordinatorSource, "CompensationType"), null, 2)} as const;`,
    "",
  );
  return `${sections.join("\n")}\n`;
}
