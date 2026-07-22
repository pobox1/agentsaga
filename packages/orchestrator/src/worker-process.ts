import { loadConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime } from "./queues.js";
import { WorkerRuntime } from "./worker-runtime.js";

const config = loadConfig();
if (!config.REDIS_URL || !config.DATABASE_URL) throw new Error("Worker requires REDIS_URL and DATABASE_URL");
const queues = new QueueRuntime(config.REDIS_URL);
const runtime = new WorkerRuntime(queues, config);
runtime.registerAll();
const publishHeartbeat = () => queues.connection.set("agentsaga:process:worker", JSON.stringify({ processId: process.pid, gitCommit: config.GIT_COMMIT_SHA, timestamp: new Date().toISOString(), mode: config.OPERATION_MODE }), "EX", config.HEARTBEAT_STALE_SECONDS * 2);
await publishHeartbeat();
const heartbeat = setInterval(() => void publishHeartbeat(), 15_000);

const close = async () => { clearInterval(heartbeat); await queues.close(); await prisma.$disconnect(); process.exit(0); };
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
process.stdout.write(`AgentSaga worker registered ${queues.registeredProcessors().length} processors\n`);
