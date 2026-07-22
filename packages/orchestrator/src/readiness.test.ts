import { describe, expect, it } from "vitest";
import { defaultCapabilities, type RuntimeCapabilities } from "./capabilities.js";
import { buildReadiness, parseHeartbeat } from "./readiness.js";
import { queueNames, type QueueName } from "./queues.js";

const heartbeat = { fresh: true, timestamp: "2026-07-22T00:00:00.000Z" };
const processors = Object.fromEntries(queueNames.map((name) => [name, heartbeat])) as Record<QueueName, typeof heartbeat>;
const dependencies = { arcRpc: "ready", database: "ready", redis: "ready", deployment: "ready", cursor: "ready", migrations: "ready" } as const;

describe("operational readiness", () => {
  it("reports manual core readiness without claiming autonomous execution", () => {
    const result = buildReadiness({ mode: "manual", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: defaultCapabilities("manual") });
    expect(result).toMatchObject({ status: "degraded", coreReady: true, autonomousReady: false, mode: "manual" });
  });
  it("rejects autonomous readiness when a signer or adapter is missing", () => {
    const result = buildReadiness({ mode: "autonomous", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: defaultCapabilities("autonomous") });
    expect(result).toMatchObject({ status: "not-ready", coreReady: true, autonomousReady: false });
    expect(result.processors["activate-node"].operational).toBe(false);
  });
  it("requires fresh worker, indexer, scheduler, and processor heartbeats", () => {
    const result = buildReadiness({ mode: "manual", ...dependencies, processes: { api: heartbeat, worker: { fresh: false }, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: defaultCapabilities("manual") });
    expect(result.coreReady).toBe(false);
    expect(parseHeartbeat(JSON.stringify({ timestamp: "2026-07-22T00:00:00.000Z" }), 45, Date.parse("2026-07-22T00:01:00.000Z")).fresh).toBe(false);
  });
  it("allows autonomous readiness only when every capability is explicitly ready", () => {
    const capabilities = Object.fromEntries(Object.keys(defaultCapabilities("autonomous")).map((key) => [key, "ready"])) as RuntimeCapabilities;
    const result = buildReadiness({ mode: "autonomous", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities });
    expect(result).toMatchObject({ status: "ready", coreReady: true, autonomousReady: true });
  });
});
