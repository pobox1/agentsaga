import { createHash } from "node:crypto";
import type { QueueName } from "./queues.js";

export type CapabilityStatus = "ready" | "manual" | "waiting_auth" | "not_configured" | "disabled" | "unhealthy";
export type OperationMode = "manual" | "hybrid" | "autonomous";
export type RuntimeCapabilities = {
  workflowOwnerSigner: CapabilityStatus;
  operatorSigner: CapabilityStatus;
  providerSigner: CapabilityStatus;
  evaluatorSigner: CapabilityStatus;
  compensationSigner: CapabilityStatus;
  compensationEvaluatorSigner: CapabilityStatus;
  circleSigner: CapabilityStatus;
  permissionlessSigner: CapabilityStatus;
  researchAgent: CapabilityStatus;
  documentAgent: CapabilityStatus;
  riskAgent: CapabilityStatus;
  paymentAgent: CapabilityStatus;
  auditAgent: CapabilityStatus;
  compensationAgent: CapabilityStatus;
  deterministicEvaluator: CapabilityStatus;
  humanEvaluator: CapabilityStatus;
  externalEvaluator: CapabilityStatus;
};

export const RUNTIME_CAPABILITY_VERSION = "2";
export type RuntimeCapabilityConfiguration = {
  version: string;
  hash: string;
  mode: OperationMode;
  capabilities: RuntimeCapabilities;
};

export const defaultCapabilities = (mode: OperationMode): RuntimeCapabilities => ({
  workflowOwnerSigner: mode === "manual" ? "manual" : "not_configured",
  operatorSigner: mode === "manual" ? "manual" : "not_configured",
  providerSigner: mode === "manual" ? "manual" : "not_configured",
  evaluatorSigner: mode === "manual" ? "manual" : "not_configured",
  compensationSigner: mode === "manual" ? "manual" : "not_configured",
  compensationEvaluatorSigner: mode === "manual" ? "manual" : "not_configured",
  circleSigner: "waiting_auth",
  permissionlessSigner: mode === "manual" ? "manual" : "not_configured",
  researchAgent: "ready",
  documentAgent: "ready",
  riskAgent: "ready",
  paymentAgent: "ready",
  auditAgent: "ready",
  compensationAgent: "ready",
  deterministicEvaluator: "ready",
  humanEvaluator: "manual",
  externalEvaluator: "not_configured",
});

export function loadRuntimeCapabilities(mode: OperationMode, serialized?: string): RuntimeCapabilities {
  const defaults = defaultCapabilities(mode);
  if (!serialized) return defaults;
  const parsed = JSON.parse(serialized) as Partial<Record<keyof RuntimeCapabilities, CapabilityStatus>>;
  const valid = new Set<CapabilityStatus>(["ready", "manual", "waiting_auth", "not_configured", "disabled", "unhealthy"]);
  for (const [key, value] of Object.entries(parsed)) if (!(key in defaults) || !valid.has(value as CapabilityStatus)) throw new Error(`Invalid runtime capability ${key}`);
  return { ...defaults, ...parsed };
}

export function loadCapabilityConfiguration(
  mode: OperationMode,
  serialized?: string,
): RuntimeCapabilityConfiguration {
  const capabilities = loadRuntimeCapabilities(mode, serialized);
  const canonical = JSON.stringify({ version: RUNTIME_CAPABILITY_VERSION, mode, capabilities });
  return {
    version: RUNTIME_CAPABILITY_VERSION,
    hash: createHash("sha256").update(canonical).digest("hex"),
    mode,
    capabilities,
  };
}

export const processorRequirements: Record<QueueName, readonly (keyof RuntimeCapabilities)[]> = {
  "index-events": [], "discover-ready-nodes": [], "reconcile-state": [], "build-receipt-index": [],
  "activate-node": ["operatorSigner"],
  "execute-agent": ["researchAgent"],
  "submit-deliverable": ["providerSigner", "compensationSigner"],
  "evaluate-job": ["deterministicEvaluator"],
  "complete-job": ["evaluatorSigner", "compensationEvaluatorSigner"],
  "reject-job": ["evaluatorSigner", "compensationEvaluatorSigner"],
  "open-compensation": ["workflowOwnerSigner", "compensationSigner", "compensationEvaluatorSigner"],
  "execute-compensation": ["compensationAgent"],
  "expire-job": ["permissionlessSigner"],
  "expire-compensation": ["permissionlessSigner"],
  "expire-workflow": ["permissionlessSigner"],
};

export function processorCapability(name: QueueName, capabilities: RuntimeCapabilities): CapabilityStatus {
  const values = processorRequirements[name].map((key) => capabilities[key]);
  if (values.length === 0 || values.every((value) => value === "ready")) return "ready";
  if (values.some((value) => value === "unhealthy")) return "unhealthy";
  if (values.some((value) => value === "waiting_auth")) return "waiting_auth";
  if (values.some((value) => value === "manual")) return "manual";
  if (values.some((value) => value === "disabled")) return "disabled";
  return "not_configured";
}

export function isOperational(status: CapabilityStatus): boolean { return status === "ready"; }

export class CapabilityRegistry {
  private readonly listeners = new Set<(key: keyof RuntimeCapabilities, status: CapabilityStatus) => void>();
  constructor(private readonly values: RuntimeCapabilities) {}
  snapshot(): RuntimeCapabilities { return { ...this.values }; }
  set(key: keyof RuntimeCapabilities, status: CapabilityStatus): void { this.values[key] = status; for (const listener of this.listeners) listener(key, status); }
  onChange(listener: (key: keyof RuntimeCapabilities, status: CapabilityStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
