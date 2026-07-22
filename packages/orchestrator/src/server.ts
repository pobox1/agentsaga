import Fastify, { type FastifyInstance } from "fastify";
import { runLocalScenario } from "./demo.js";

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 256 * 1024,
  });
  app.get("/health", async () => ({ status: "ok", service: "agentsaga-orchestrator" }));
  app.get("/ready", async () => ({
    status: "ready",
    arcRpcConfigured: Boolean(process.env.ARC_TESTNET_RPC_URL),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    mode: "no-secrets-required-for-local-demo",
  }));
  app.post<{ Body: { failRisk?: boolean } }>("/v1/local-scenarios/run", async (request) => ({
    evidenceMode: "local-deterministic-not-onchain",
    receipt: await runLocalScenario(request.body.failRisk ?? false),
  }));
  return app;
}

async function main(): Promise<void> {
  const app = createServer();
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  await app.listen({ host: "127.0.0.1", port });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  await main();
}

