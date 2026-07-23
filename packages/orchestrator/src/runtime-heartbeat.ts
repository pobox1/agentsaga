import type IORedis from "ioredis";
import type { RuntimeCapabilityConfiguration } from "./capabilities.js";

export type RuntimeProcess = "api" | "worker" | "indexer" | "scheduler";
export type RuntimeHeartbeatIdentity = {
  processId: number;
  gitCommit: string;
  timestamp: string;
  mode: RuntimeCapabilityConfiguration["mode"];
  configVersion: string;
  configHash: string;
};

export function heartbeatIdentity(
  configuration: RuntimeCapabilityConfiguration,
  gitCommit: string,
): RuntimeHeartbeatIdentity {
  return {
    processId: process.pid,
    gitCommit,
    timestamp: new Date().toISOString(),
    mode: configuration.mode,
    configVersion: configuration.version,
    configHash: configuration.hash,
  };
}

export async function publishProcessHeartbeat(
  redis: Pick<IORedis, "set">,
  processName: RuntimeProcess,
  configuration: RuntimeCapabilityConfiguration,
  gitCommit: string,
  staleSeconds: number,
): Promise<void> {
  await redis.set(
    `agentsaga:process:${processName}`,
    JSON.stringify(heartbeatIdentity(configuration, gitCommit)),
    "EX",
    staleSeconds * 2,
  );
}
