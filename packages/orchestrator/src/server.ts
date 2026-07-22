import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runLocalScenario } from "./demo.js";
import { loadConfig, type OrchestratorConfig } from "./config.js";
import { createDemoAgents } from "./agents.js";
import { prisma, PostgresActionLedger } from "./postgres.js";
import { QueueRuntime, type QueueName } from "./queues.js";
import { createPublicClient, http } from "viem";
import { arcTestnet } from "@agentsaga/contracts";

const localScenarioBody = z.object({ failRisk: z.boolean().optional() }).strict();
const addressParams = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
const agentParams = z.object({ id: z.string().min(1).max(128) });

export function createServer(config: OrchestratorConfig = loadConfig()): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.entitySecret", "*.otp"] },
    bodyLimit: 256 * 1024,
    requestIdHeader: "x-request-id",
  });
  const requests = new Map<string, { count: number; resetAt: number }>();
  const allowedOrigins = new Set(config.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
  const apiTokens = new Set([config.ORCHESTRATOR_API_TOKEN, ...(config.ORCHESTRATOR_API_TOKENS?.split(",") ?? [])].filter((token): token is string => Boolean(token?.trim())).map((token) => token.trim()));
  const queueRuntime = config.REDIS_URL ? new QueueRuntime(config.REDIS_URL) : undefined;
  const arcClient = createPublicClient({ chain: arcTestnet, transport: http(config.ARC_TESTNET_RPC_URL) });
  app.addHook("onClose", async () => { await queueRuntime?.close(); await prisma.$disconnect(); });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return reply.code(403).send({ error: "origin_not_allowed" });
    if (origin && allowedOrigins.has(origin)) {
      void reply.header("access-control-allow-origin", origin).header("access-control-allow-methods", "GET,POST,OPTIONS").header("access-control-allow-headers", "authorization,content-type").header("vary", "origin");
    }
    if (request.method === "OPTIONS") return reply.code(204).send();
    if (!request.url.startsWith("/v1/")) return;
    const suppliedToken = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
    const protectedRoute = request.method !== "GET" || request.url.startsWith("/v1/dead-letters") || request.url.startsWith("/v1/queue-status");
    if (protectedRoute && (!suppliedToken || !apiTokens.has(suppliedToken))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const now = Date.now();
    if (config.NODE_ENV === "production" && queueRuntime) {
      const key = `agentsaga:rate:${request.ip}:${Math.floor(now / 60_000)}`;
      const count = await queueRuntime.connection.incr(key); if (count === 1) await queueRuntime.connection.expire(key, 61);
      if (count > 60) return reply.code(429).send({ error: "rate_limit_exceeded" });
    } else {
      const bucket = requests.get(request.ip);
      const next = !bucket || bucket.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { ...bucket, count: bucket.count + 1 };
      requests.set(request.ip, next);
      if (next.count > 60) return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" && request.url.startsWith("/v1/")) request.log.info({ method: request.method, route: request.routeOptions.url, statusCode: reply.statusCode, requestId: request.id }, "operator audit event");
  });
  app.get("/health", async () => ({ status: "ok", service: "agentsaga-orchestrator" }));
  app.get("/ready", async (_request, reply) => {
    const [database, arcRpc] = await Promise.all([probeDatabase(Boolean(config.DATABASE_URL)), arcClient.getBlockNumber().then(() => "ready" as const).catch(() => "unavailable" as const)]);
    const redis = queueRuntime ? await queueRuntime.connection.ping().then(() => "ready" as const).catch(() => "unavailable" as const) : "not-configured" as const;
    const processors = queueRuntime && redis === "ready" ? await queueRuntime.processorReadiness() : undefined;
    const allProcessors = Boolean(processors && Object.values(processors).every(Boolean));
    const cursor = config.DATABASE_URL && config.WORKFLOW_FACTORY_ADDRESS ? await prisma.chainCursor.findUnique({ where: { id: `arc:${arcTestnet.id}:factory:${config.WORKFLOW_FACTORY_ADDRESS.toLowerCase()}` } }).then((value) => value ? "ready" as const : "missing" as const).catch(() => "unavailable" as const) : "not-configured" as const;
    const deployment = config.WORKFLOW_FACTORY_ADDRESS && config.FACTORY_DEPLOYMENT_BLOCK !== undefined ? "configured" as const : "not-configured" as const;
    const ready = arcRpc === "ready" && database === "ready" && redis === "ready" && allProcessors && cursor === "ready" && deployment === "configured";
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not-ready", arcRpc, database, redis, processors, indexerCursor: cursor, deployment, circle: config.CIRCLE_INTEGRATION_STATUS, x402: config.X402_INTEGRATION_STATUS });
  });
  app.get("/metrics", async (_request, reply) => reply.type("text/plain").send([
    "# HELP agentsaga_up Whether the orchestrator process is up.",
    "# TYPE agentsaga_up gauge", "agentsaga_up 1", "",
  ].join("\n")));
  app.get("/version", async () => ({ service: "agentsaga-orchestrator", commit: config.GIT_COMMIT_SHA }));
  app.get("/v1/workflows/:address", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    if (!config.DATABASE_URL) return reply.code(503).send({ error: "database_not_configured" });
    const workflow = await prisma.workflow.findUnique({ where: { address: parsed.data.address.toLowerCase() }, include: { nodes: { orderBy: { nodeId: "asc" } } } });
    return workflow ? serialize(workflow) : reply.code(404).send({ error: "workflow_not_indexed" });
  });
  app.get("/v1/workflows", async (_request, reply) => config.DATABASE_URL ? { workflows: serialize(await prisma.workflow.findMany({ orderBy: { createdBlock: "desc" }, take: 100 })) } : reply.code(503).send({ error: "database_not_configured" }));
  app.get("/v1/workflows/:address/nodes", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    return config.DATABASE_URL ? { nodes: serialize(await prisma.workflowNode.findMany({ where: { workflowAddress: parsed.data.address.toLowerCase() }, orderBy: { nodeId: "asc" } })) } : reply.code(503).send({ error: "database_not_configured" });
  });
  app.get("/v1/workflows/:address/events", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    if (!config.DATABASE_URL) return reply.code(503).send({ error: "database_not_configured" });
    const events = await prisma.indexedEvent.findMany({ where: { payload: { path: ["address"], equals: parsed.data.address.toLowerCase() } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }], take: 1_000 });
    return { events: serialize(events) };
  });
  app.get("/v1/workflows/:address/executions", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    if (!config.DATABASE_URL) return reply.code(503).send({ error: "database_not_configured" });
    const workflowAddress = parsed.data.address.toLowerCase();
    const [executions, decisions] = await Promise.all([prisma.agentExecution.findMany({ where: { workflowAddress }, orderBy: { startedAt: "asc" } }), prisma.evaluatorDecision.findMany({ where: { workflowAddress }, orderBy: { evaluatedAt: "asc" } })]);
    return { executions, decisions };
  });
  app.get("/v1/workflows/:address/transactions", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    return config.DATABASE_URL ? { transactions: serialize(await prisma.chainTransaction.findMany({ where: { workflowAddress: parsed.data.address.toLowerCase() }, orderBy: { submittedAt: "asc" } })) } : reply.code(503).send({ error: "database_not_configured" });
  });
  app.get("/v1/workflows/:address/receipt", async (request, reply) => {
    const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
    if (!config.DATABASE_URL) return reply.code(503).send({ error: "database_not_configured" });
    const receipt = await prisma.evidenceRecord.findFirst({ where: { workflowAddress: parsed.data.address.toLowerCase(), kind: "workflow-receipt" }, orderBy: { createdAt: "desc" } });
    return receipt ? serialize(receipt) : reply.code(404).send({ error: "receipt_not_indexed" });
  });
  app.get("/v1/queue-status", async (_request, reply) => {
    if (!queueRuntime) return reply.code(503).send({ error: "redis_not_configured" });
    const counts = await Promise.all(Object.entries(queueRuntime.queues).map(async ([name, queue]) => [name, await queue.getJobCounts("waiting", "active", "failed", "delayed")]));
    return { queues: Object.fromEntries(counts), processors: await queueRuntime.processorReadiness() };
  });
  app.get("/v1/dead-letters", async (_request, reply) => config.DATABASE_URL ? { deadLetters: serialize(await prisma.deadLetterRecord.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 100 })) } : reply.code(503).send({ error: "database_not_configured" }));
  app.post("/v1/dead-letters/:id/retry", async (request, reply) => {
    const id = z.object({ id: z.string().min(1).max(128) }).safeParse(request.params); if (!id.success) return reply.code(400).send({ error: "invalid_dead_letter" });
    if (!queueRuntime || !config.DATABASE_URL) return reply.code(503).send({ error: "persistent_runtime_not_configured" });
    const record = await prisma.deadLetterRecord.findUnique({ where: { id: id.data.id } }); if (!record || record.resolvedAt) return reply.code(404).send({ error: "dead_letter_not_found" });
    await queueRuntime.enqueue(record.queue as QueueName, `dlq-retry:${record.id}:${record.attempts}`, record.payload);
    await prisma.deadLetterRecord.update({ where: { id: record.id }, data: { resolvedAt: new Date() } });
    return reply.code(202).send({ status: "queued" });
  });
  app.get("/v1/agents", async () => ({ agents: createDemoAgents().map(({ id, capabilities }) => ({ id, capabilities, adapter: "deterministic-local" })) }));
  app.get("/v1/agents/:id", async (request, reply) => {
    const parsed = agentParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_agent_id" });
    const agent = createDemoAgents().find((candidate) => candidate.id === parsed.data.id);
    return agent ? { id: agent.id, capabilities: agent.capabilities, adapter: "deterministic-local" } : reply.code(404).send({ error: "agent_not_found" });
  });
  for (const [path, queue] of [["run-ready", "discover-ready-nodes"], ["reconcile", "reconcile-state"]] as const) {
    app.post(`/v1/workflows/:address/${path}`, async (request, reply) => {
      const parsed = addressParams.safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_address" });
      if (!config.DATABASE_URL || !queueRuntime) return reply.code(503).send({ error: "persistent_runtime_not_configured" });
      const workflow = parsed.data.address.toLowerCase();
      const key = `${queue}:${workflow}`; const id = createHash("sha256").update(key).digest("hex");
      await new PostgresActionLedger().reserve({ id, workflow, action: queue, idempotencyKey: key, payload: { workflow } });
      await queueRuntime.enqueue(queue as QueueName, key, { workflow });
      return reply.code(202).send({ status: "queued", action: queue, idempotencyKey: key });
    });
  }
  app.post("/v1/local-scenarios/run", async (request, reply) => {
    const parsed = localScenarioBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return { evidenceMode: "local-deterministic-not-onchain", receipt: await runLocalScenario(parsed.data.failRisk ?? false) };
  });
  return app;
}

async function probeDatabase(configured: boolean): Promise<"ready" | "unavailable" | "not-configured"> {
  if (!configured) return "not-configured";
  return prisma.$queryRaw`SELECT 1`.then(() => "ready" as const).catch(() => "unavailable" as const);
}

function serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as T; }

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createServer(config);
  const close = async (signal: string) => { app.log.info({ signal }, "graceful shutdown"); await app.close(); process.exit(0); };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
  await app.listen({ host: config.HOST, port: config.PORT });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) await main();
