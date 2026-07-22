import { isOperational, processorCapability, type OperationMode, type RuntimeCapabilities } from "./capabilities.js";
import { queueNames, type QueueName } from "./queues.js";

export type DependencyState = "ready" | "unavailable" | "not-configured" | "missing" | "stale";
export type ProcessHeartbeat = { fresh: boolean; timestamp?: string; processId?: number; gitCommit?: string; mode?: OperationMode };
export type ProcessorHeartbeat = ProcessHeartbeat & { capability?: string };

export function buildReadiness(input: {
  mode: OperationMode; arcRpc: DependencyState; database: DependencyState; redis: DependencyState; deployment: DependencyState; cursor: DependencyState; migrations: DependencyState;
  processes: { api: ProcessHeartbeat; worker: ProcessHeartbeat; indexer: ProcessHeartbeat; scheduler: ProcessHeartbeat };
  processorHeartbeats: Record<QueueName, ProcessorHeartbeat>; capabilities: RuntimeCapabilities;
}) {
  const processors = Object.fromEntries(queueNames.map((name) => {
    const heartbeat = input.processorHeartbeats[name]; const capability = processorCapability(name, input.capabilities);
    return [name, { registered: Boolean(heartbeat?.timestamp), heartbeat: heartbeat?.fresh ? "fresh" : "stale", capability, operational: Boolean(heartbeat?.fresh && isOperational(capability)) }];
  })) as Record<QueueName, { registered: boolean; heartbeat: "fresh" | "stale"; capability: string; operational: boolean }>;
  const coreReady = [input.arcRpc, input.database, input.redis, input.deployment, input.cursor, input.migrations].every((value) => value === "ready") && Object.values(input.processes).every((heartbeat) => heartbeat.fresh) && Object.values(input.processorHeartbeats).every((heartbeat) => heartbeat.fresh);
  const autonomousReady = coreReady && Object.values(processors).every((processor) => processor.operational);
  const servingReady = input.mode === "autonomous" ? autonomousReady : coreReady;
  return { status: servingReady ? autonomousReady ? "ready" : "degraded" : "not-ready", coreReady, autonomousReady, mode: input.mode, processors } as const;
}

export function parseHeartbeat(value: string | null, staleSeconds: number, now = Date.now()): ProcessHeartbeat {
  if (!value) return { fresh: false };
  try { const parsed = JSON.parse(value) as Omit<ProcessHeartbeat, "fresh">; return { ...parsed, fresh: Boolean(parsed.timestamp && now - Date.parse(parsed.timestamp) <= staleSeconds * 1_000) }; }
  catch { return { fresh: false }; }
}
