import { describe, expect, it } from "vitest";
import { defaultCapabilities, loadCapabilityConfiguration, type RuntimeCapabilities } from "./capabilities.js";
import { buildReadiness, parseHeartbeat } from "./readiness.js";
import { queueNames, type QueueName } from "./queues.js";

const dependencies = { arcRpc: "ready", database: "ready", redis: "ready", deployment: "ready", cursor: "ready", migrations: "ready" } as const;
function fixtures(mode: "manual" | "hybrid" | "autonomous", capabilities = defaultCapabilities(mode)) {
  const configuration = loadCapabilityConfiguration(mode, JSON.stringify(capabilities));
  const heartbeat = { fresh: true, timestamp: "2026-07-22T00:00:00.000Z", mode, configVersion: configuration.version, configHash: configuration.hash };
  const processors = Object.fromEntries(queueNames.map((name) => [name, {
    ...heartbeat,
    registered: true,
    configuredCapability: "ready",
    dependencyStatus: "ready",
    operational: true,
  }])) as Record<QueueName, typeof heartbeat & { registered: true; configuredCapability: "ready"; dependencyStatus: "ready"; operational: true }>;
  return { configuration, heartbeat, processors };
}

describe("operational readiness", () => {
  it("reports manual core readiness without claiming autonomous execution", () => {
    const { configuration, heartbeat, processors } = fixtures("manual");
    const result = buildReadiness({ mode: "manual", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: configuration.capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash });
    expect(result).toMatchObject({ status: "degraded", coreReady: true, autonomousReady: false, mode: "manual" });
  });
  it("rejects autonomous readiness when a signer or adapter is missing", () => {
    const { configuration, heartbeat, processors } = fixtures("autonomous");
    processors["activate-node"] = { ...processors["activate-node"], signerAvailability: "missing", dependencyStatus: "missing", operational: false };
    const result = buildReadiness({ mode: "autonomous", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: configuration.capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash });
    expect(result).toMatchObject({ status: "not-ready", coreReady: true, autonomousReady: false });
    expect(result.processors["activate-node"].operational).toBe(false);
  });
  it("requires fresh worker, indexer, scheduler, and processor heartbeats", () => {
    const { configuration, heartbeat, processors } = fixtures("manual");
    const result = buildReadiness({ mode: "manual", ...dependencies, processes: { api: heartbeat, worker: { ...heartbeat, fresh: false }, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: configuration.capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash });
    expect(result.coreReady).toBe(false);
    expect(parseHeartbeat(JSON.stringify({ timestamp: "2026-07-22T00:00:00.000Z" }), 45, Date.parse("2026-07-22T00:01:00.000Z")).fresh).toBe(false);
  });
  it("allows autonomous readiness only when every capability is explicitly ready", () => {
    const capabilities = Object.fromEntries(Object.keys(defaultCapabilities("autonomous")).map((key) => [key, "ready"])) as RuntimeCapabilities;
    const { configuration, heartbeat, processors } = fixtures("autonomous", capabilities);
    const result = buildReadiness({ mode: "autonomous", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash });
    expect(result).toMatchObject({ status: "ready", coreReady: true, autonomousReady: true });
  });
  it("degrades incompatible API and worker capability configurations", () => {
    const { configuration, heartbeat, processors } = fixtures("hybrid");
    const result = buildReadiness({ mode: "hybrid", ...dependencies, processes: { api: heartbeat, worker: { ...heartbeat, configHash: "different" }, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities: configuration.capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash });
    expect(result).toMatchObject({ status: "not-ready", coreReady: false, autonomousReady: false, configurationCompatible: false });
  });
  it("surfaces adapter absence and failed projections", () => {
    const capabilities = Object.fromEntries(Object.keys(defaultCapabilities("autonomous")).map((key) => [key, "ready"])) as RuntimeCapabilities;
    const { configuration, heartbeat, processors } = fixtures("autonomous", capabilities);
    processors["execute-agent"] = { ...processors["execute-agent"], adapterAvailability: "missing", dependencyStatus: "missing", operational: false };
    const result = buildReadiness({ mode: "autonomous", ...dependencies, processes: { api: heartbeat, worker: heartbeat, indexer: heartbeat, scheduler: heartbeat }, processorHeartbeats: processors, capabilities, expectedConfigVersion: configuration.version, expectedConfigHash: configuration.hash, failedProjections: 1 });
    expect(result).toMatchObject({ status: "not-ready", coreReady: false, autonomousReady: false, eventProjection: { failed: 1 } });
  });
});
