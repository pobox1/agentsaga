import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import { createPublicClient, http, type Address } from "viem";
import { arcTestnet, workflowCoordinatorAbi } from "@agentsaga/contracts";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { OrchestratorConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime, queueNames, type QueueName } from "./queues.js";

const payloadSchema = z.object({ workflow: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nodeId: z.number().int().min(0).max(15).optional() }).passthrough();
export type ProcessorOutcome = { status: "complete" | "waiting_for_human_approval" | "waiting_for_role_wallet" | "blocked_external_auth" | "not_configured" | "already_complete"; detail?: string; enqueued?: number };
const writeQueues = new Set<QueueName>(["activate-node", "submit-deliverable", "complete-job", "reject-job", "open-compensation", "expire-job", "expire-compensation", "expire-workflow"]);

export class WorkerRuntime {
  private readonly client;
  constructor(readonly queues: QueueRuntime, private readonly config: OrchestratorConfig) {
    this.client = createPublicClient({ chain: arcTestnet, transport: http(config.ARC_TESTNET_RPC_URL) });
  }

  registerAll(): void {
    for (const name of queueNames) this.queues.register(name, (job) => this.process(name, job));
  }

  private async process(name: QueueName, job: Job): Promise<ProcessorOutcome> {
    const parsed = payloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error(`Invalid ${name} payload`);
    const workflow = parsed.data.workflow.toLowerCase();
    const idempotencyKey = `${name}:${job.id ?? stableId(job.data)}`;
    const existing = await prisma.workerAction.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "complete") return { status: "already_complete" };
    const action = await prisma.workerAction.upsert({
      where: { idempotencyKey },
      create: { id: stableId(idempotencyKey), workflow, nodeId: parsed.data.nodeId ?? null, action: name, idempotencyKey, status: "claimed", attempts: job.attemptsMade + 1, payload: parsed.data as Prisma.InputJsonValue },
      update: { status: "claimed", attempts: job.attemptsMade + 1, lastError: null },
    });
    await prisma.workerAction.update({ where: { id: action.id }, data: { status: "running" } });
    try {
      const outcome = await this.execute(name, parsed.data as { workflow: Address; nodeId?: number });
      await prisma.workerAction.update({ where: { id: action.id }, data: { status: outcome.status === "complete" || outcome.status === "already_complete" ? "complete" : "waiting", lastError: outcome.detail ?? null } });
      return outcome;
    } catch (error) {
      const message = sanitizeError(error);
      await prisma.workerAction.update({ where: { id: action.id }, data: { status: "failed", lastError: message } });
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await prisma.deadLetterRecord.upsert({ where: { id: stableId(`${name}:${job.id}`) }, create: { id: stableId(`${name}:${job.id}`), queue: name, originalJobId: job.id ?? null, payload: parsed.data as Prisma.InputJsonValue, error: message, attempts: job.attemptsMade + 1 }, update: { error: message, attempts: job.attemptsMade + 1 } });
      throw error;
    }
  }

  private async execute(name: QueueName, payload: { workflow: Address; nodeId?: number }): Promise<ProcessorOutcome> {
    if (name === "discover-ready-nodes") return this.discoverReadyNodes(payload.workflow);
    if (name === "index-events") return { status: "not_configured", detail: "The persistent indexer process owns RPC log ingestion" };
    if (name === "reconcile-state") {
      const [status, count] = await Promise.all([
        this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "status" }),
        this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "nodeCount" }),
      ]);
      await prisma.workflow.update({ where: { address: payload.workflow.toLowerCase() }, data: { status: String(status), nodeCount: Number(count), state: { reconciledAt: new Date().toISOString(), source: "arc-rpc" } } });
      return { status: "complete", detail: "Database state reconciled from Arc RPC" };
    }
    if (name === "build-receipt-index") {
      const finalized = await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" });
      if (!finalized) return { status: "not_configured", detail: "Workflow is not finalized" };
      const receipt = await prisma.evidenceRecord.findFirst({ where: { workflowAddress: payload.workflow.toLowerCase(), kind: "workflow-receipt" } });
      return receipt ? { status: "complete", detail: "Indexed receipt exists" } : { status: "not_configured", detail: "Receipt finalization event has not been indexed" };
    }
    if (name === "execute-agent" || name === "evaluate-job" || name === "execute-compensation") return { status: "not_configured", detail: "No external agent adapter is configured" };
    if (writeQueues.has(name)) return { status: "waiting_for_role_wallet", detail: `No least-privilege ${roleFor(name)} signer is configured` };
    return { status: "not_configured", detail: `Processor ${name} requires an upstream execution artifact` };
  }

  private async discoverReadyNodes(workflow: Address): Promise<ProcessorOutcome> {
    const count = Number(await this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "nodeCount" }));
    let enqueued = 0;
    let humanGated = 0;
    for (let nodeId = 0; nodeId < count; nodeId++) {
      const node = await this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [nodeId] });
      if (Number(node.status) !== 1) continue;
      if (node.humanApprovalRequired && !node.humanApproved) { humanGated++; continue; }
      await this.queues.enqueue("activate-node", `${workflow}:${nodeId}:activate`, { workflow, nodeId });
      enqueued++;
    }
    if (humanGated && !enqueued) return { status: "waiting_for_human_approval", detail: `${humanGated} ready node(s) require NodeApproved` };
    return { status: "complete", enqueued };
  }
}

function stableId(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function roleFor(name: QueueName): string { return name === "submit-deliverable" ? "provider" : name === "complete-job" || name === "reject-job" ? "evaluator" : "operator"; }
function sanitizeError(error: unknown): string { return (error instanceof Error ? error.message : "unknown worker error").replace(/(token|secret|password|private.?key)\s*[=:]\s*\S+/gi, "$1=[redacted]").slice(0, 2_000); }
