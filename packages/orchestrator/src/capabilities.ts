import type { QueueName } from "./queues.js";

export type CapabilityStatus = "ready" | "manual" | "waiting_auth" | "not_configured" | "disabled" | "unhealthy";
export type OperationMode = "manual" | "hybrid" | "autonomous";
export type RuntimeCapabilities = {
  operatorSigner: CapabilityStatus;
  providerSigner: CapabilityStatus;
  evaluatorSigner: CapabilityStatus;
  compensationSigner: CapabilityStatus;
  circleSigner: CapabilityStatus;
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

export const defaultCapabilities = (mode: OperationMode): RuntimeCapabilities => ({
  operatorSigner: mode === "manual" ? "manual" : "not_configured",
  providerSigner: mode === "manual" ? "manual" : "not_configured",
  evaluatorSigner: mode === "manual" ? "manual" : "not_configured",
  compensationSigner: mode === "manual" ? "manual" : "not_configured",
  circleSigner: "waiting_auth",
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

const requirements: Record<QueueName, readonly (keyof RuntimeCapabilities)[]> = {
  "index-events": [], "discover-ready-nodes": [], "reconcile-state": [], "build-receipt-index": [],
  "activate-node": ["operatorSigner"],
  "execute-agent": ["researchAgent"],
  "submit-deliverable": ["providerSigner"],
  "evaluate-job": ["deterministicEvaluator"],
  "complete-job": ["evaluatorSigner"],
  "reject-job": ["evaluatorSigner"],
  "open-compensation": ["operatorSigner"],
  "execute-compensation": ["compensationAgent"],
  "expire-job": ["operatorSigner"],
  "expire-compensation": ["compensationSigner"],
  "expire-workflow": ["operatorSigner"],
};

export function processorCapability(name: QueueName, capabilities: RuntimeCapabilities): CapabilityStatus {
  const values = requirements[name].map((key) => capabilities[key]);
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
