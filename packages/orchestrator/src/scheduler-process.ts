import { loadConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime } from "./queues.js";
import { WaitingActionScheduler } from "./waiting-action-scheduler.js";

const config = loadConfig();
if (!config.REDIS_URL || !config.DATABASE_URL) throw new Error("Scheduler requires REDIS_URL and DATABASE_URL");
const queues = new QueueRuntime(config.REDIS_URL);
const scheduler = new WaitingActionScheduler(prisma, queues);
let stopping = false;
const heartbeat = async () => queues.connection.set("agentsaga:process:scheduler", JSON.stringify({ processId: process.pid, gitCommit: config.GIT_COMMIT_SHA, timestamp: new Date().toISOString(), mode: config.OPERATION_MODE }), "EX", config.HEARTBEAT_STALE_SECONDS * 2);
const close = async () => { stopping = true; await queues.close(); await prisma.$disconnect(); process.exit(0); };
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
while (!stopping) {
  await heartbeat();
  await scheduler.runOnce();
  await new Promise((resolve) => setTimeout(resolve, config.WAITING_SCHEDULER_INTERVAL_MS));
}
