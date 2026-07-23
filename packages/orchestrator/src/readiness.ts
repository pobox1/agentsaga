import { isOperational, processorCapability, type OperationMode, type RuntimeCapabilities } from "./capabilities.js";
import { queueNames, type ProcessorHeartbeatDetail, type QueueName } from "./queues.js";

export type DependencyState = "ready" | "unavailable" | "not-configured" | "missing" | "failed" | "stale";
export type ProcessHeartbeat = {
  fresh: boolean;
  timestamp?: string;
  processId?: number;
  gitCommit?: string;
  mode?: OperationMode;
  configVersion?: string;
  configHash?: string;
};
export type ProcessorHeartbeat = ProcessorHeartbeatDetail;

export function buildReadiness(input: {
  mode: OperationMode; arcRpc: DependencyState; database: DependencyState; redis: DependencyState; deployment: DependencyState; cursor: DependencyState; migrations: DependencyState;
  processes: { api: ProcessHeartbeat; worker: ProcessHeartbeat; indexer: ProcessHeartbeat; scheduler: ProcessHeartbeat };
  processorHeartbeats: Record<QueueName, ProcessorHeartbeat>; capabilities: RuntimeCapabilities;
  expectedConfigVersion?: string; expectedConfigHash?: string;
  projectionBacklog?: number; failedProjections?: number;
}) {
  const processors = Object.fromEntries(queueNames.map((name) => {
    const heartbeat = input.processorHeartbeats[name];
    const declaredCapability = processorCapability(name, input.capabilities);
    const configurationMatches = Boolean(
      heartbeat?.configVersion === input.expectedConfigVersion
      && heartbeat?.configHash === input.expectedConfigHash,
    );
    const configuredCapability = heartbeat?.configuredCapability ?? declaredCapability;
    const factualOperational = Boolean(heartbeat?.operational);
    return [name, {
      registered: Boolean(heartbeat?.registered && heartbeat.timestamp),
      heartbeat: heartbeat?.fresh ? "fresh" : "stale",
      configuredCapability,
      declaredCapability,
      dependencyStatus: heartbeat?.dependencyStatus ?? "missing",
      signerAvailability: heartbeat?.signerAvailability,
      signerRole: heartbeat?.signerRole,
      adapterAvailability: heartbeat?.adapterAvailability,
      configurationMatches,
      operational: Boolean(
        heartbeat?.fresh
        && configurationMatches
        && isOperational(declaredCapability)
        && configuredCapability === declaredCapability
        && factualOperational,
      ),
      detail: heartbeat?.detail,
    }];
  })) as Record<QueueName, {
    registered: boolean;
    heartbeat: "fresh" | "stale";
    configuredCapability: string;
    declaredCapability: string;
    dependencyStatus: string;
    signerAvailability?: string;
    signerRole?: string;
    adapterAvailability?: string;
    configurationMatches: boolean;
    operational: boolean;
    detail?: string;
  }>;
  const processConfigurationMatches = Object.values(input.processes).every((heartbeat) =>
    heartbeat.configVersion === input.expectedConfigVersion
    && heartbeat.configHash === input.expectedConfigHash
    && heartbeat.mode === input.mode,
  );
  const coreReady = [input.arcRpc, input.database, input.redis, input.deployment, input.cursor, input.migrations].every((value) => value === "ready")
    && Object.values(input.processes).every((heartbeat) => heartbeat.fresh)
    && Object.values(input.processorHeartbeats).every((heartbeat) => heartbeat.fresh)
    && processConfigurationMatches
    && (input.failedProjections ?? 0) === 0;
  const autonomousReady = input.mode === "autonomous"
    && coreReady
    && Object.values(processors).every((processor) => processor.operational);
  const servingReady = input.mode === "autonomous" ? autonomousReady : coreReady;
  return {
    status: servingReady ? autonomousReady ? "ready" : "degraded" : "not-ready",
    coreReady,
    autonomousReady,
    mode: input.mode,
    configurationCompatible: processConfigurationMatches && Object.values(processors).every((processor) => processor.configurationMatches),
    eventProjection: { backlog: input.projectionBacklog ?? 0, failed: input.failedProjections ?? 0 },
    processors,
  } as const;
}

export function parseHeartbeat(value: string | null, staleSeconds: number, now = Date.now()): ProcessHeartbeat {
  if (!value) return { fresh: false };
  try { const parsed = JSON.parse(value) as Omit<ProcessHeartbeat, "fresh">; return { ...parsed, fresh: Boolean(parsed.timestamp && now - Date.parse(parsed.timestamp) <= staleSeconds * 1_000) }; }
  catch { return { fresh: false }; }
}
