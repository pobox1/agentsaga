import type { Address } from "viem";
import type { TransactionSigner } from "./transaction-signer.js";

export type SignerRole = "workflow-owner" | "operator" | "provider" | "evaluator" | "compensation-provider" | "permissionless-executor" | "circle-agent-wallet";
export type SignerScope = { workflow: Address; nodeId?: number; role: SignerRole; expectedAddress?: Address };

export class SignerRegistry {
  private readonly entries = new Map<string, TransactionSigner>();
  private readonly listeners = new Set<(scope: SignerScope) => void | Promise<void>>();
  async register(scope: SignerScope, signer: TransactionSigner): Promise<void> { this.entries.set(this.key(scope), signer); await Promise.all([...this.listeners].map((listener) => listener(scope))); }
  unregister(scope: SignerScope): void { this.entries.delete(this.key(scope)); }
  async resolve(scope: SignerScope): Promise<TransactionSigner | undefined> {
    const signer = this.entries.get(this.key(scope)) ?? this.entries.get(this.key({ workflow: scope.workflow, role: scope.role }));
    if (!signer || await signer.status() !== "ready") return undefined;
    if (scope.expectedAddress && (await signer.address()).toLowerCase() !== scope.expectedAddress.toLowerCase()) return undefined;
    return signer;
  }
  onRegistered(listener: (scope: SignerScope) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private key(scope: SignerScope): string { return `${scope.workflow.toLowerCase()}:${scope.nodeId ?? "*"}:${scope.role}`; }
}
