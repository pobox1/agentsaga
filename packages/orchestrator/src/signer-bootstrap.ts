import { z } from "zod";
import type { Address } from "viem";
import type { OrchestratorConfig } from "./config.js";
import { CircleAgentWalletSigner, DisabledSigner, LocalEncryptedTestSigner, ManualOperatorSigner, type TransactionSigner } from "./transaction-signer.js";
import { SignerRegistry, type SignerRole, type SignerScope } from "./signer-registry.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value as Address);
const role = z.enum(["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "compensation-evaluator", "permissionless-executor", "circle-agent-wallet"]);
const scope = z.object({
  workflow: address,
  nodeId: z.number().int().min(0).max(15).optional(),
  role,
  expectedAddress: address.optional(),
});
const envelope = z.object({
  salt: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
}).strict();
const signerEntry = z.discriminatedUnion("backend", [
  scope.extend({ backend: z.literal("disabled"), reason: z.string().max(256).optional() }),
  scope.extend({ backend: z.literal("manual"), address }),
  scope.extend({
    backend: z.literal("encrypted-local"),
    envelope,
    passphraseEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/),
  }),
  scope.extend({ backend: z.literal("circle"), adapterId: z.string().min(1).max(128).optional() }),
  scope.extend({ backend: z.literal("external"), adapterId: z.string().min(1).max(128) }),
]);
const signerConfiguration = z.object({ version: z.literal(1), signers: z.array(signerEntry).max(256) }).strict();

export type SignerBootstrapResult = {
  configured: number;
  ready: number;
  waitingExternalAuth: number;
  roles: Partial<Record<SignerRole, { configured: number; ready: number }>>;
};

export async function bootstrapSigners(input: {
  config: OrchestratorConfig;
  registry?: SignerRegistry;
  environment?: NodeJS.ProcessEnv;
  externalAdapters?: ReadonlyMap<string, TransactionSigner>;
}): Promise<{ registry: SignerRegistry; result: SignerBootstrapResult }> {
  const registry = input.registry ?? new SignerRegistry();
  const environment = input.environment ?? process.env;
  const parsed = input.config.SIGNER_CONFIG_JSON
    ? signerConfiguration.parse(JSON.parse(input.config.SIGNER_CONFIG_JSON))
    : { version: 1 as const, signers: [] };
  const result: SignerBootstrapResult = { configured: 0, ready: 0, waitingExternalAuth: 0, roles: {} };
  const seen = new Set<string>();
  for (const entry of parsed.signers) {
    const key = `${entry.workflow.toLowerCase()}:${entry.nodeId ?? "*"}:${entry.role}`;
    if (seen.has(key)) throw new Error(`Duplicate signer scope ${key}`);
    seen.add(key);
    const signer = createSigner(entry, input.config, environment, input.externalAdapters);
    const signerScope: SignerScope = {
      workflow: entry.workflow,
      role: entry.role,
      ...(entry.nodeId === undefined ? {} : { nodeId: entry.nodeId }),
      ...(entry.expectedAddress === undefined ? {} : { expectedAddress: entry.expectedAddress }),
    };
    await registry.register(signerScope, signer);
    const status = await signer.status();
    result.configured++;
    if (status === "ready") result.ready++;
    if (status === "blocked_external_auth") result.waitingExternalAuth++;
    const roleResult = result.roles[entry.role] ?? { configured: 0, ready: 0 };
    roleResult.configured++;
    if (status === "ready") roleResult.ready++;
    result.roles[entry.role] = roleResult;
  }
  if (input.config.OPERATION_MODE === "autonomous") {
    const required: SignerRole[] = ["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "compensation-evaluator", "permissionless-executor"];
    const workflows = [...new Set(parsed.signers.map((entry) => entry.workflow.toLowerCase() as Address))];
    if (workflows.length === 0) throw new Error("Autonomous signer bootstrap has no workflow-scoped signer configuration");
    const missing: string[] = [];
    for (const workflow of workflows) {
      for (const requiredRole of required) {
        if (!(await registry.scopeReady({ workflow, role: requiredRole }))) missing.push(`${workflow}:${requiredRole}`);
      }
    }
    if (missing.length) throw new Error(`Autonomous signer bootstrap missing ready scopes: ${missing.join(", ")}`);
  }
  return { registry, result };
}

type ParsedSigner = z.infer<typeof signerEntry>;
function createSigner(
  entry: ParsedSigner,
  config: OrchestratorConfig,
  environment: NodeJS.ProcessEnv,
  externalAdapters: ReadonlyMap<string, TransactionSigner> | undefined,
): TransactionSigner {
  if (entry.backend === "disabled") return new DisabledSigner(entry.reason);
  if (entry.backend === "manual") {
    if (entry.expectedAddress && entry.address.toLowerCase() !== entry.expectedAddress.toLowerCase()) {
      throw new Error(`Manual signer address does not match configured ${entry.role} address`);
    }
    return new ManualOperatorSigner(entry.address);
  }
  if (entry.backend === "encrypted-local") {
    if (config.NODE_ENV === "production" && !config.ALLOW_ENCRYPTED_LOCAL_SIGNERS) {
      throw new Error("Encrypted local signers are disabled in production");
    }
    const passphrase = environment[entry.passphraseEnv];
    if (!passphrase) throw new Error(`Secret manager did not supply ${entry.passphraseEnv}`);
    return LocalEncryptedTestSigner.fromEnvironment(JSON.stringify(entry.envelope), passphrase, config.ARC_TESTNET_RPC_URL);
  }
  if (entry.backend === "external") {
    return externalAdapters?.get(entry.adapterId) ?? new DisabledSigner(`External signer adapter ${entry.adapterId} is unavailable`);
  }
  const external = entry.adapterId ? externalAdapters?.get(entry.adapterId) : undefined;
  if (external) return external;
  return new CircleAgentWalletSigner(entry.expectedAddress);
}
