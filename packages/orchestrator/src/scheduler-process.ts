import { loadConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime } from "./queues.js";
import { WaitingActionScheduler } from "./waiting-action-scheduler.js";
import { loadCapabilityConfiguration } from "./capabilities.js";
import { publishProcessHeartbeat } from "./runtime-heartbeat.js";

const config = loadConfig();
if (!config.REDIS_URL || !config.DATABASE_URL) throw new Error("Scheduler requires REDIS_URL and DATABASE_URL");
const capabilityConfiguration = loadCapabilityConfiguration(config.OPERATION_MODE, config.RUNTIME_CAPABILITIES_JSON);
const queues = new QueueRuntime(config.REDIS_URL, { ...capabilityConfiguration, gitCommit: config.GIT_COMMIT_SHA });
const scheduler = new WaitingActionScheduler(prisma, queues);
let stopping = false;
const heartbeat = async () => publishProcessHeartbeat(queues.connection, "scheduler", capabilityConfiguration, config.GIT_COMMIT_SHA, config.HEARTBEAT_STALE_SECONDS);
const close = async () => { stopping = true; await queues.close(); await prisma.$disconnect(); };
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
while (!stopping) {
  try {
    await scheduler.runOnce();
    await heartbeat();
  } catch (error) {
    process.stderr.write(`Scheduler cycle failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, config.WAITING_SCHEDULER_INTERVAL_MS));
}
