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
  ORCHESTRATOR_API_TOKENS: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  CIRCLE_INTEGRATION_STATUS: z.enum(["not configured", "code integrated", "operator authentication required", "authenticated test environment", "test transaction verified"]).default("code integrated"),
  X402_INTEGRATION_STATUS: z.enum(["local fixture only", "real testnet pending", "real testnet verified"]).default("local fixture only"),
  GIT_COMMIT_SHA: z.string().default("unknown"),
  OPERATION_MODE: z.enum(["manual", "hybrid", "autonomous"]).default("manual"),
  RUNTIME_CAPABILITIES_JSON: z.string().optional(),
  SIGNER_CONFIG_JSON: z.string().optional(),
  ALLOW_ENCRYPTED_LOCAL_SIGNERS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  HEARTBEAT_STALE_SECONDS: z.coerce.number().int().min(10).max(300).default(45),
  WAITING_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(250).max(300_000).default(5_000),
  WAITING_ACTION_RETRY_SECONDS: z.coerce.number().int().min(1).max(86_400).default(30),
  WORKFLOW_FACTORY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  RECEIPT_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  FACTORY_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative().optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;
  for (const key of ["DATABASE_URL", "REDIS_URL", "WORKFLOW_FACTORY_ADDRESS", "FACTORY_DEPLOYMENT_BLOCK"] as const) {
    if (!value[key]) context.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
  }
  if (!value.ORCHESTRATOR_API_TOKEN && !value.ORCHESTRATOR_API_TOKENS) context.addIssue({ code: "custom", path: ["ORCHESTRATOR_API_TOKEN"], message: "At least one rotating API token is required in production" });
});

export type OrchestratorConfig = z.infer<typeof schema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return schema.parse(environment);
}
