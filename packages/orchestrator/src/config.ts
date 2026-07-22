import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ARC_TESTNET_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  ORCHESTRATOR_API_TOKEN: z.string().min(24).optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  CIRCLE_INTEGRATION_STATUS: z.enum(["not configured", "code integrated", "operator authentication required", "authenticated test environment", "test transaction verified"]).default("code integrated"),
  X402_INTEGRATION_STATUS: z.enum(["local fixture only", "real testnet pending", "real testnet verified"]).default("local fixture only"),
  GIT_COMMIT_SHA: z.string().default("unknown"),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;
  for (const key of ["DATABASE_URL", "REDIS_URL", "ORCHESTRATOR_API_TOKEN"] as const) {
    if (!value[key]) context.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
  }
});

export type OrchestratorConfig = z.infer<typeof schema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return schema.parse(environment);
}
