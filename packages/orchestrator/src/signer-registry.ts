import type { Address } from "viem";
import type { TransactionSigner } from "./transaction-signer.js";

export type SignerRole = "workflow-owner" | "operator" | "provider" | "evaluator" | "compensation-provider" | "compensation-evaluator" | "permissionless-executor" | "circle-agent-wallet";
export type SignerScope = { workflow: Address; nodeId?: number; role: SignerRole; expectedAddress?: Address };
export type SignerFact = {
  role: SignerRole;
  configured: boolean;
  ready: boolean;
  status: Awaited<ReturnType<TransactionSigner["status"]>> | "missing";
  scopedEntries: number;
};

export class SignerRegistry {
  private readonly entries = new Map<string, { scope: SignerScope; signer: TransactionSigner }>();
  private readonly listeners = new Set<(scope: SignerScope) => void | Promise<void>>();
  async register(scope: SignerScope, signer: TransactionSigner): Promise<void> {
    const status = await signer.status();
    if (scope.expectedAddress && (status === "ready" || status === "manual")) {
      const actual = await signer.address();
      if (actual.toLowerCase() !== scope.expectedAddress.toLowerCase()) {
        throw new Error(`Signer address does not match configured ${scope.role} address`);
      }
    }
    this.entries.set(this.key(scope), { scope, signer });
    await Promise.all([...this.listeners].map((listener) => listener(scope)));
  }
  unregister(scope: SignerScope): void { this.entries.delete(this.key(scope)); }
  async resolve(scope: SignerScope): Promise<TransactionSigner | undefined> {
    const entry = this.entries.get(this.key(scope)) ?? this.entries.get(this.key({ workflow: scope.workflow, role: scope.role }));
    const signer = entry?.signer;
    if (!signer || await signer.status() !== "ready") return undefined;
    if (scope.expectedAddress && (await signer.address()).toLowerCase() !== scope.expectedAddress.toLowerCase()) return undefined;
    return signer;
  }
  async facts(): Promise<Record<SignerRole, SignerFact>> {
    const roles: SignerRole[] = ["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "compensation-evaluator", "permissionless-executor", "circle-agent-wallet"];
    const facts = await Promise.all(roles.map(async (role): Promise<[SignerRole, SignerFact]> => {
      const entries = [...this.entries.values()].filter((entry) => entry.scope.role === role);
      const statuses = await Promise.all(entries.map((entry) => entry.signer.status()));
      const ready = statuses.includes("ready");
      const status = ready ? "ready" : statuses.includes("blocked_external_auth") ? "blocked_external_auth" : statuses.includes("manual") ? "manual" : statuses.includes("disabled") ? "disabled" : "missing";
      return [role, { role, configured: entries.length > 0, ready, status, scopedEntries: entries.length }];
    }));
    return Object.fromEntries(facts) as Record<SignerRole, SignerFact>;
  }
  async roleReady(role: SignerRole): Promise<boolean> { return (await this.facts())[role].ready; }
  async scopeReady(scope: Omit<SignerScope, "expectedAddress">): Promise<boolean> {
    const entry = this.entries.get(this.key(scope)) ?? this.entries.get(this.key({ workflow: scope.workflow, role: scope.role }));
    return Boolean(entry && await entry.signer.status() === "ready");
  }
  async coverage(scopes: ReadonlyArray<Omit<SignerScope, "expectedAddress">>): Promise<{ required: number; covered: number; missing: Array<Omit<SignerScope, "expectedAddress">> }> {
    const missing: Array<Omit<SignerScope, "expectedAddress">> = [];
    for (const scope of scopes) if (!(await this.scopeReady(scope))) missing.push(scope);
    return { required: scopes.length, covered: scopes.length - missing.length, missing };
  }
  async addressFor(scope: Omit<SignerScope, "expectedAddress">): Promise<Address | undefined> {
    const entry = this.entries.get(this.key(scope)) ?? this.entries.get(this.key({ workflow: scope.workflow, role: scope.role }));
    if (!entry || await entry.signer.status() !== "ready") return undefined;
    return entry.signer.address();
  }
  onRegistered(listener: (scope: SignerScope) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private key(scope: SignerScope): string { return `${scope.workflow.toLowerCase()}:${scope.nodeId ?? "*"}:${scope.role}`; }
}
