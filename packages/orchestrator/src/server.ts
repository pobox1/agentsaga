import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { runLocalScenario } from "./demo.js";
import { loadConfig, type OrchestratorConfig } from "./config.js";

const localScenarioBody = z.object({ failRisk: z.boolean().optional() }).strict();

export function createServer(config: OrchestratorConfig = loadConfig()): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.entitySecret", "*.otp"] },
    bodyLimit: 256 * 1024,
    requestIdHeader: "x-request-id",
  });
  const requests = new Map<string, { count: number; resetAt: number }>();
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    if (config.ORCHESTRATOR_API_TOKEN && request.headers.authorization !== `Bearer ${config.ORCHESTRATOR_API_TOKEN}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const now = Date.now();
    const bucket = requests.get(request.ip);
    const next = !bucket || bucket.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { ...bucket, count: bucket.count + 1 };
    requests.set(request.ip, next);
    if (next.count > 60) return reply.code(429).send({ error: "rate_limit_exceeded" });
  });
  app.get("/health", async () => ({ status: "ok", service: "agentsaga-orchestrator" }));
  app.get("/ready", async (_request, reply) => {
    const ready = config.NODE_ENV !== "production" || Boolean(config.DATABASE_URL && config.REDIS_URL);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not-ready", arcRpcConfigured: true, databaseConfigured: Boolean(config.DATABASE_URL), redisConfigured: Boolean(config.REDIS_URL) });
  });
  app.get("/metrics", async (_request, reply) => reply.type("text/plain").send([
    "# HELP agentsaga_up Whether the orchestrator process is up.",
    "# TYPE agentsaga_up gauge", "agentsaga_up 1", "",
  ].join("\n")));
  app.get("/version", async () => ({ service: "agentsaga-orchestrator", commit: config.GIT_COMMIT_SHA }));
  app.post("/v1/local-scenarios/run", async (request, reply) => {
    const parsed = localScenarioBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return { evidenceMode: "local-deterministic-not-onchain", receipt: await runLocalScenario(parsed.data.failRisk ?? false) };
  });
  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createServer(config);
  const close = async (signal: string) => { app.log.info({ signal }, "graceful shutdown"); await app.close(); process.exit(0); };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
  await app.listen({ host: config.HOST, port: config.PORT });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) await main();
