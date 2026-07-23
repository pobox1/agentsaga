import { loadConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime } from "./queues.js";
import { WorkerRuntime } from "./worker-runtime.js";
import { loadCapabilityConfiguration } from "./capabilities.js";
import { bootstrapSigners } from "./signer-bootstrap.js";
import { publishProcessHeartbeat } from "./runtime-heartbeat.js";

const config = loadConfig();
if (!config.REDIS_URL || !config.DATABASE_URL) throw new Error("Worker requires REDIS_URL and DATABASE_URL");
const capabilityConfiguration = loadCapabilityConfiguration(config.OPERATION_MODE, config.RUNTIME_CAPABILITIES_JSON);
const queues = new QueueRuntime(config.REDIS_URL, { ...capabilityConfiguration, gitCommit: config.GIT_COMMIT_SHA });
const { registry: signers } = await bootstrapSigners({ config });
const runtime = new WorkerRuntime(queues, config, signers, capabilityConfiguration.capabilities);
runtime.registerAll();
await queues.waitUntilReady();
const facts = await runtime.factualProcessorCapabilities();
if (config.OPERATION_MODE === "autonomous") {
  const unavailable = Object.entries(facts).filter(([, fact]) => !fact.operational).map(([name]) => name);
  if (unavailable.length) throw new Error(`Autonomous worker dependencies are not operational: ${unavailable.join(", ")}`);
}
const publishHeartbeat = async () => {
  await publishProcessHeartbeat(queues.connection, "worker", capabilityConfiguration, config.GIT_COMMIT_SHA, config.HEARTBEAT_STALE_SECONDS);
  await queues.publishProcessorHeartbeat();
  const currentFacts = await runtime.factualProcessorCapabilities();
  await Promise.all(Object.entries(currentFacts).map(([processor, fact]) => prisma.processorCapability.upsert({
    where: { processor },
    create: {
      processor,
      status: fact.operational ? "ready" : "unavailable",
      mode: config.OPERATION_MODE,
      detail: fact.detail ?? null,
      configuredStatus: fact.configuredCapability,
      dependencyStatus: fact.dependencyStatus,
      signerAvailability: fact.signerAvailability ?? null,
      signerRole: fact.signerRole ?? null,
      adapterAvailability: fact.adapterAvailability ?? null,
      operational: fact.operational,
      configVersion: capabilityConfiguration.version,
      configHash: capabilityConfiguration.hash,
      processId: process.pid,
      gitCommit: config.GIT_COMMIT_SHA ?? null,
      heartbeatAt: new Date(),
    },
    update: {
      status: fact.operational ? "ready" : "unavailable",
      mode: config.OPERATION_MODE,
      detail: fact.detail ?? null,
      configuredStatus: fact.configuredCapability,
      dependencyStatus: fact.dependencyStatus,
      signerAvailability: fact.signerAvailability ?? null,
      signerRole: fact.signerRole ?? null,
      adapterAvailability: fact.adapterAvailability ?? null,
      operational: fact.operational,
      configVersion: capabilityConfiguration.version,
      configHash: capabilityConfiguration.hash,
      processId: process.pid,
      gitCommit: config.GIT_COMMIT_SHA ?? null,
      heartbeatAt: new Date(),
    },
  })));
};
await publishHeartbeat();
const heartbeat = setInterval(() => void publishHeartbeat().catch((error: unknown) => {
  process.stderr.write(`Worker heartbeat failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
}), 15_000);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  await queues.pauseWorkers();
  await queues.close();
  await prisma.$disconnect();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
process.stdout.write(`AgentSaga worker registered ${queues.registeredProcessors().length} processors\n`);
