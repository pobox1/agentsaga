import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runLocalScenario } from "./demo.js";
import { loadConfig, type OrchestratorConfig } from "./config.js";
import { createDemoAgents } from "./agents.js";
import { prisma, PostgresActionLedger } from "./postgres.js";
import { QueueRuntime, type QueueName } from "./queues.js";

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
  const queueRuntime = config.REDIS_URL ? new QueueRuntime(config.REDIS_URL) : undefined;
  app.addHook("onClose", async () => { await queueRuntime?.close(); await prisma.$disconnect(); });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      void reply.header("access-control-allow-origin", origin).header("vary", "origin");
    }
    if (!request.url.startsWith("/v1/")) return;
    if (request.method !== "GET" && (!config.ORCHESTRATOR_API_TOKEN || request.headers.authorization !== `Bearer ${config.ORCHESTRATOR_API_TOKEN}`)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const now = Date.now();
    const bucket = requests.get(request.ip);
    const next = !bucket || bucket.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { ...bucket, count: bucket.count + 1 };
    requests.set(request.ip, next);
    if (next.count > 60) return reply.code(429).send({ error: "rate_limit_exceeded" });
  });
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" && request.url.startsWith("/v1/")) request.log.info({ method: request.method, route: request.routeOptions.url, statusCode: reply.statusCode, requestId: request.id }, "operator audit event");
  });
  app.get("/health", async () => ({ status: "ok", service: "agentsaga-orchestrator" }));
  app.get("/ready", async (_request, reply) => {
    const database = await probeDatabase(Boolean(config.DATABASE_URL));
    const redis = queueRuntime ? await queueRuntime.connection.ping().then(() => "ready" as const).catch(() => "unavailable" as const) : "not-configured" as const;
    const ready = config.NODE_ENV !== "production" || (database === "ready" && redis === "ready");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not-ready", arcRpc: "configured", database, redis, circle: config.CIRCLE_INTEGRATION_STATUS, x402: config.X402_INTEGRATION_STATUS });
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
