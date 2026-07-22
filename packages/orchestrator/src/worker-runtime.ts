import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import { createPublicClient, encodeFunctionData, http, type Address, type Hash } from "viem";
import { agentJobAdapterAbi, arcTestnet, receiptRegistryAbi, workflowCoordinatorAbi, workflowStatusLabels } from "@agentsaga/contracts";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { OrchestratorConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime, queueNames, type QueueName } from "./queues.js";
import { createDemoAgents } from "./agents.js";
import { DeterministicSchemaEvaluator } from "./evaluators.js";
import { defaultCapabilities, processorCapability, type RuntimeCapabilities } from "./capabilities.js";
import { SignerRegistry, type SignerRole } from "./signer-registry.js";
import type { ContractWriteRequest } from "./transaction-signer.js";

const payloadSchema = z.object({
  workflow: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nodeId: z.number().int().min(0).max(15).optional(),
  logicalActionKey: z.string().optional(), actionId: z.string().optional(), resumeSequence: z.number().int().nonnegative().optional(), executionAttempt: z.number().int().nonnegative().optional(),
  agentId: z.string().optional(), reasonHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), evaluator: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), deadline: z.number().int().positive().optional(),
}).passthrough();
type ActionPayload = z.infer<typeof payloadSchema> & { workflow: Address };

export type ProcessorOutcome =
  | { status: "complete"; detail?: string; enqueued?: number }
  | { status: "already_complete"; detail?: string }
  | { status: "waiting"; reason: "human_approval" | "role_signer" | "agent_adapter" | "evaluator_adapter" | "circle_auth" | "external_service" | "upstream_artifact" | "workflow_state" | "not_yet_due"; retryable: boolean; retryAfterSeconds?: number; detail: string }
  | { status: "blocked"; reason: "configuration_error" | "unsupported_action" | "invalid_workflow" | "invalid_role" | "permanent_external_failure"; detail: string };

export class WorkerRuntime {
  private readonly client;
  private readonly capabilities: RuntimeCapabilities;
  constructor(
    readonly queues: QueueRuntime,
    private readonly config: OrchestratorConfig,
    private readonly signers = new SignerRegistry(),
    capabilities?: RuntimeCapabilities,
  ) {
    this.client = createPublicClient({ chain: arcTestnet, transport: http(config.ARC_TESTNET_RPC_URL) });
    this.capabilities = capabilities ?? defaultCapabilities(config.OPERATION_MODE);
    this.signers.onRegistered(async (scope) => { await prisma.workerAction.updateMany({ where: { workflow: scope.workflow.toLowerCase(), status: "waiting", waitingReason: "role_signer", ...(scope.nodeId === undefined ? {} : { nodeId: scope.nodeId }) }, data: { nextAttemptAt: new Date() } }); });
  }

  registerAll(): void { for (const name of queueNames) this.queues.register(name, (job) => this.process(name, job), processorCapability(name, this.capabilities)); }

  async process(name: QueueName, job: Job): Promise<ProcessorOutcome> {
    const parsed = payloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error(`Invalid ${name} payload`);
    const payload = { ...parsed.data, workflow: parsed.data.workflow.toLowerCase() as Address } as ActionPayload;
    const logicalActionKey = payload.logicalActionKey ?? `${name}:${payload.workflow}:${payload.nodeId ?? "workflow"}`;
    const existing = await prisma.workerAction.findUnique({ where: { idempotencyKey: logicalActionKey } });
    if (existing && ["completed", "already_complete", "blocked_permanently", "dead_lettered", "cancelled"].includes(existing.status)) return { status: "already_complete", detail: `Logical action is terminal: ${existing.status}` };
    const action = await prisma.workerAction.upsert({
      where: { idempotencyKey: logicalActionKey },
      create: { id: payload.actionId ?? stableId(logicalActionKey), workflow: payload.workflow, nodeId: payload.nodeId ?? null, action: name, idempotencyKey: logicalActionKey, status: "reserved", attempts: 0, payload: payload as Prisma.InputJsonValue },
      update: {},
    });
    const leaseOwner = `${process.pid}:${job.id ?? stableId(job.data)}`; const now = new Date();
    const claim = await prisma.workerAction.updateMany({ where: { id: action.id, status: { in: ["reserved", "queued", "waiting", "failed"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }, data: { status: "running", startedAt: now, lastError: null, leaseOwner, leaseExpiresAt: new Date(now.getTime() + 60_000) } });
    if (claim.count === 0) return { status: "waiting", reason: "workflow_state", retryable: true, retryAfterSeconds: 5, detail: "Logical action is already claimed by another worker" };
    try {
      const outcome = await this.execute(name, payload);
      if (outcome.status === "waiting") {
        await prisma.workerAction.update({ where: { id: action.id }, data: { ...outcomePersistence(outcome, new Date(), this.config.WAITING_ACTION_RETRY_SECONDS), leaseOwner: null, leaseExpiresAt: null } });
      } else if (outcome.status === "blocked") {
        await prisma.workerAction.update({ where: { id: action.id }, data: { status: "blocked_permanently", waitingReason: null, nextAttemptAt: null, lastResult: outcome as Prisma.InputJsonValue, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      } else {
        await prisma.workerAction.update({ where: { id: action.id }, data: { status: outcome.status === "already_complete" ? "already_complete" : "completed", waitingReason: null, nextAttemptAt: null, lastResult: outcome as Prisma.InputJsonValue, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      }
      return outcome;
    } catch (error) {
      const message = sanitizeError(error);
      const executionAttempts = action.executionAttempts + 1;
      const exhausted = executionAttempts >= (job.opts.attempts ?? 1);
      await prisma.workerAction.update({ where: { id: action.id }, data: { status: exhausted ? "dead_lettered" : "failed", attempts: executionAttempts, executionAttempts, lastError: message, leaseOwner: null, leaseExpiresAt: null, ...(exhausted ? { completedAt: new Date() } : {}) } });
      if (exhausted) await prisma.deadLetterRecord.upsert({ where: { id: stableId(`${name}:${job.id}`) }, create: { id: stableId(`${name}:${job.id}`), queue: name, originalJobId: job.id ?? null, payload: payload as Prisma.InputJsonValue, error: message, attempts: executionAttempts }, update: { error: message, attempts: executionAttempts } });
      throw error;
    }
  }

  private async execute(name: QueueName, payload: ActionPayload): Promise<ProcessorOutcome> {
    const capability = processorCapability(name, this.capabilities);
    if (capability !== "ready" && name !== "discover-ready-nodes") {
      const reason = name.includes("agent") || name === "execute-compensation" ? "agent_adapter" : name === "evaluate-job" ? "evaluator_adapter" : capability === "waiting_auth" ? "circle_auth" : "role_signer";
      return { status: "waiting", reason, retryable: true, detail: `${name} capability is ${capability}` };
    }
    if (name === "discover-ready-nodes") return this.discoverReadyNodes(payload.workflow);
    if (name === "index-events") return { status: "complete", detail: "Persistent indexer owns RPC ingestion" };
    if (name === "reconcile-state") return this.reconcile(payload.workflow);
    if (name === "build-receipt-index") {
      const finalized = await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" });
      if (!finalized) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Workflow is not finalized" };
      const existing = await prisma.evidenceRecord.findFirst({ where: { workflowAddress: payload.workflow, kind: "workflow-receipt" } });
      if (existing) return { status: "complete", detail: "Indexed public receipt exists" };
      if (!this.config.RECEIPT_REGISTRY_ADDRESS) return { status: "waiting", reason: "external_service", retryable: true, detail: "Receipt registry address is not configured" };
      const receipt = await this.client.readContract({ address: this.config.RECEIPT_REGISTRY_ADDRESS as Address, abi: receiptRegistryAbi, functionName: "getReceipt", args: [payload.workflow] });
      await prisma.evidenceRecord.create({ data: { id: `${payload.workflow}:receipt`, workflowAddress: payload.workflow, kind: "workflow-receipt", commitment: stableId(receipt), metadata: jsonValue(receipt) } });
      return { status: "complete", detail: "Public receipt read directly from registry and persisted" };
    }
    if (name === "execute-agent" || name === "execute-compensation") return this.executeAgent(payload, name === "execute-compensation");
    if (name === "evaluate-job") return this.evaluate(payload);
    return this.executeWrite(name, payload);
  }

  private async discoverReadyNodes(workflow: Address): Promise<ProcessorOutcome> {
    const [count, status, finalized] = await Promise.all([
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "nodeCount" }),
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "status" }),
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }),
    ]);
    if (finalized) return { status: "already_complete", detail: "Workflow is finalized" };
    if (![2, 3].includes(Number(status))) return { status: "waiting", reason: "workflow_state", retryable: true, detail: `Workflow status ${status} is not activatable` };
    let enqueued = 0; let humanGated = 0;
    for (let nodeId = 0; nodeId < Number(count); nodeId++) {
      const node = await this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [nodeId] });
      if (Number(node.status) !== 1) continue;
      const logicalKey = `${workflow}:${nodeId}:activate-node`;
      const existing = await prisma.workerAction.findUnique({ where: { idempotencyKey: logicalKey } });
      if (existing && !["failed", "cancelled"].includes(existing.status)) continue;
      if (node.humanApprovalRequired && !node.humanApproved) {
        await this.persistPlannedWaiting(workflow, nodeId, "activate-node", logicalKey, "human_approval", { workflow, nodeId }); humanGated++; continue;
      }
      const actionId = stableId(logicalKey);
      await prisma.workerAction.upsert({ where: { idempotencyKey: logicalKey }, create: { id: actionId, workflow, nodeId, action: "activate-node", idempotencyKey: logicalKey, status: "queued", payload: { workflow, nodeId } }, update: { status: "queued", waitingReason: null, nextAttemptAt: null } });
      await this.queues.enqueue("activate-node", logicalKey, { workflow, nodeId }, { actionId, resumeSequence: existing?.resumeSequence ?? 0, executionAttempt: existing?.executionAttempts ?? 0 }); enqueued++;
    }
    if (humanGated && !enqueued) return { status: "waiting", reason: "human_approval", retryable: false, detail: `${humanGated} ready node(s) require NodeApproved` };
    return { status: "complete", enqueued };
  }

  private async persistPlannedWaiting(workflow: Address, nodeId: number, action: QueueName, idempotencyKey: string, waitingReason: string, payload: Prisma.InputJsonValue): Promise<void> {
    await prisma.workerAction.upsert({ where: { idempotencyKey }, create: { id: stableId(idempotencyKey), workflow, nodeId, action, idempotencyKey, status: "waiting", waitingReason, payload }, update: { status: "waiting", waitingReason, payload } });
  }

  private async executeAgent(payload: ActionPayload, compensation: boolean): Promise<ProcessorOutcome> {
    if (payload.nodeId === undefined) return { status: "blocked", reason: "invalid_workflow", detail: "Agent execution requires nodeId" };
    const existing = await prisma.agentExecution.findFirst({ where: { workflowAddress: payload.workflow, nodeId: payload.nodeId, status: "complete" }, orderBy: { completedAt: "desc" } });
    if (existing) return { status: "already_complete", detail: "Agent execution artifact already exists" };
    const agents = createDemoAgents();
    const selected = agents.find((agent) => agent.id === payload.agentId) ?? agents[compensation ? agents.length - 1 : payload.nodeId % (agents.length - 1)];
    if (!selected) return { status: "waiting", reason: "agent_adapter", retryable: true, detail: "No matching agent adapter is configured" };
    const input = { workflowId: payload.workflow, nodeId: payload.nodeId, specification: { compensation }, dependencyEvidence: [], maximumCost: 0n };
    const startedAt = new Date();
    const result = await selected.execute(input);
    await prisma.agentExecution.create({ data: { id: stableId(`${payload.workflow}:${payload.nodeId}:${selected.id}:${startedAt.toISOString()}`), workflowAddress: payload.workflow, nodeId: payload.nodeId, agentId: selected.id, status: "complete", input: jsonValue(input), output: jsonValue(result), evidenceHash: result.deliverableHash, cost: result.cost, startedAt, completedAt: new Date(result.completedAt) } });
    await this.enqueueNext("submit-deliverable", { ...payload, reasonHash: result.deliverableHash });
    return { status: "complete", detail: `${selected.id} produced ${result.deliverableHash}`, enqueued: 1 };
  }

  private async evaluate(payload: ActionPayload): Promise<ProcessorOutcome> {
    if (payload.nodeId === undefined) return { status: "blocked", reason: "invalid_workflow", detail: "Evaluation requires nodeId" };
    const execution = await prisma.agentExecution.findFirst({ where: { workflowAddress: payload.workflow, nodeId: payload.nodeId, status: "complete" }, orderBy: { completedAt: "desc" } });
    if (!execution?.output) return { status: "waiting", reason: "upstream_artifact", retryable: true, detail: "Agent execution result is not stored" };
    const result = execution.output as unknown as Parameters<DeterministicSchemaEvaluator["evaluate"]>[0]["result"];
    const decision = await new DeterministicSchemaEvaluator().evaluate({ workflowId: payload.workflow, nodeId: payload.nodeId, result });
    await prisma.evaluatorDecision.upsert({ where: { id: stableId(`${payload.workflow}:${payload.nodeId}:${execution.id}`) }, create: { id: stableId(`${payload.workflow}:${payload.nodeId}:${execution.id}`), workflowAddress: payload.workflow, nodeId: payload.nodeId, evaluatorId: decision.evaluatorId, decision: decision.decision, reasonCode: decision.reasonCode, evidenceHash: decision.evidenceHash, evaluatedAt: new Date(decision.evaluatedAt) }, update: {} });
    await this.enqueueNext(decision.decision === "approve" ? "complete-job" : "reject-job", { ...payload, reasonHash: decision.evidenceHash });
    return { status: "complete", detail: `Evaluator decision: ${decision.decision}`, enqueued: 1 };
  }

  private async executeWrite(name: QueueName, payload: ActionPayload): Promise<ProcessorOutcome> {
    if (payload.nodeId === undefined && !["expire-workflow"].includes(name)) return { status: "blocked", reason: "invalid_workflow", detail: `${name} requires nodeId` };
    const node = payload.nodeId === undefined ? undefined : await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [payload.nodeId] });
    if (node && isAlreadyComplete(name, Number(node.status))) return { status: "already_complete", detail: `Fresh onchain node status is ${node.status}` };
    if (name === "activate-node" && node?.humanApprovalRequired && !node.humanApproved) return { status: "waiting", reason: "human_approval", retryable: false, detail: "NodeApproved is required before activation" };
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (name === "expire-job" && node && now < BigInt(node.expiry)) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(BigInt(node.expiry) - now), detail: "Job expiry is not yet due" };
    if (name === "expire-workflow") { const deadline = await this.readGlobalDeadline(payload.workflow); if (deadline !== undefined && now < deadline) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(deadline - now), detail: "Workflow expiry is not yet due" }; }
    const adapter = await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "jobAdapter" });
    if (name === "expire-compensation" && node) { const job = await this.client.readContract({ address: adapter, abi: agentJobAdapterAbi, functionName: "getJob", args: [node.jobId] }); if (now < BigInt(job.expiredAt)) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(BigInt(job.expiredAt) - now), detail: "Compensation expiry is not yet due" }; }
    if (name === "open-compensation" && payload.nodeId !== undefined) { const mask = Number(await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" })); const highest = mask === 0 ? -1 : 31 - Math.clz32(mask); if (highest !== payload.nodeId) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Compensation must proceed in reverse order" }; }
    if (name === "expire-workflow") { const [finalized, status, pendingMask] = await Promise.all([this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "status" }), this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" })]); if (finalized) return { status: "already_complete", detail: "Workflow is finalized" }; if (Number(status) === 4 || Number(pendingMask) !== 0) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Compensation must resolve before workflow expiry" }; }
    const role = signerRole(name);
    const expectedAddress = role === "provider" ? node?.provider : role === "evaluator" ? node?.evaluator : role === "workflow-owner" ? await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "owner" }) : undefined;
    const signer = await this.signers.resolve({ workflow: payload.workflow, ...(payload.nodeId === undefined ? {} : { nodeId: payload.nodeId }), role, ...(expectedAddress ? { expectedAddress } : {}) });
    if (!signer) return { status: "waiting", reason: "role_signer", retryable: true, detail: `A ready ${role} signer matching the fresh onchain role is required` };
    const request = writeRequest(name, payload, adapter, node?.jobId);
    if (!request) return { status: "blocked", reason: "unsupported_action", detail: `${name} has no safe write mapping` };
    const sender = await signer.address();
    await this.client.call({ account: sender, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) });
    const action = await prisma.workerAction.findUniqueOrThrow({ where: { idempotencyKey: payload.logicalActionKey ?? `${name}:${payload.workflow}:${payload.nodeId ?? "workflow"}` } });
    const hash = await signer.sendContractTransaction(request);
    const transaction = await this.client.getTransaction({ hash });
    await prisma.workerAction.update({ where: { id: action.id }, data: { transactionHash: hash, transactionNonce: transaction.nonce, signerRole: role, lastResult: { status: "submitted", hash, sender, nonce: transaction.nonce } } });
    await prisma.chainTransaction.upsert({ where: { hash }, create: { hash, workflowAddress: payload.workflow, chainId: arcTestnet.id, action: name, status: "submitted", fromAddress: sender.toLowerCase(), toAddress: request.address.toLowerCase(), payload: jsonValue(payload), submittedAt: new Date() }, update: {} });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${name} transaction reverted`);
    await prisma.chainTransaction.update({ where: { hash }, data: { status: "confirmed", blockNumber: receipt.blockNumber, confirmedAt: new Date() } });
    if (["activate-node", "submit-deliverable", "complete-job", "reject-job"].includes(name)) await this.enqueueNext(name === "activate-node" ? "execute-agent" : name === "submit-deliverable" ? "evaluate-job" : name === "complete-job" ? "discover-ready-nodes" : "reconcile-state", payload);
    return { status: "complete", detail: `${name} confirmed in ${hash}` };
  }

  private async enqueueNext(name: QueueName, payload: ActionPayload): Promise<void> {
    const logicalKey = `${payload.workflow}:${payload.nodeId ?? "workflow"}:${name}`; const actionId = stableId(logicalKey);
    await prisma.workerAction.upsert({ where: { idempotencyKey: logicalKey }, create: { id: actionId, workflow: payload.workflow, nodeId: payload.nodeId ?? null, action: name, idempotencyKey: logicalKey, status: "queued", payload: jsonValue(payload) }, update: {} });
    await this.queues.enqueue(name, logicalKey, payload, { actionId, resumeSequence: 0, executionAttempt: 0 });
  }

  private async reconcile(workflow: Address): Promise<ProcessorOutcome> {
    const [status, count, finalized, deposited, completedMask, failedMask, skippedMask, compensationPendingMask, compensatedMask, compensationUnresolvedMask] = await Promise.all([
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "status" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "nodeCount" }),
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "deposited" }),
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "completedMask" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "failedMask" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "skippedMask" }),
      this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensatedMask" }), this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationUnresolvedMask" }),
    ]);
    const statusCode = Number(status); const statusLabel = workflowStatusLabel(statusCode);
    await prisma.workflow.update({ where: { address: workflow }, data: { status: statusLabel, statusCode, statusLabel, nodeCount: Number(count), state: jsonValue({ finalized, deposited, completedMask, failedMask, skippedMask, compensationPendingMask, compensatedMask, compensationUnresolvedMask, reconciledAt: new Date().toISOString(), source: "arc-rpc" }) } });
    return { status: "complete", detail: "Database state reconciled from Arc RPC" };
  }

  private async readGlobalDeadline(workflow: Address): Promise<bigint | undefined> {
    const bytecode = await this.client.getBytecode({ address: workflow }); if (!bytecode) return undefined;
    const start = 2 + (0x2d + 6 * 0x20) * 2; const encoded = bytecode.slice(start, start + 64);
    return encoded.length === 64 ? BigInt(`0x${encoded}`) : undefined;
  }
}

function writeRequest(name: QueueName, payload: ActionPayload, adapter: Address, jobId?: bigint): ContractWriteRequest | undefined {
  const reason = (payload.reasonHash ?? `0x${"00".repeat(32)}`) as Hash;
  if (name === "activate-node") return { address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "activateNode", args: [payload.nodeId!] } as const;
  if (name === "submit-deliverable") return { address: adapter, abi: agentJobAdapterAbi, functionName: "submit", args: [jobId!, reason] } as const;
  if (name === "complete-job") return { address: adapter, abi: agentJobAdapterAbi, functionName: "complete", args: [jobId!, reason] } as const;
  if (name === "reject-job") return { address: adapter, abi: agentJobAdapterAbi, functionName: "reject", args: [jobId!, reason] } as const;
  if (name === "open-compensation" && payload.provider && payload.evaluator && payload.deadline) return { address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "openNextCompensation", args: [payload.nodeId!, payload.provider as Address, payload.evaluator as Address, payload.deadline] } as const;
  if (name === "expire-job") return { address: adapter, abi: agentJobAdapterAbi, functionName: "claimRefund", args: [jobId!] } as const;
  if (name === "expire-compensation") return { address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "expireCompensation", args: [payload.nodeId!] } as const;
  if (name === "expire-workflow") return { address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "expireWorkflow", args: [] } as const;
  return undefined;
}
function signerRole(name: QueueName): SignerRole { if (name === "submit-deliverable") return "provider"; if (name === "complete-job" || name === "reject-job") return "evaluator"; if (name === "open-compensation") return "workflow-owner"; if (name.startsWith("expire-")) return "permissionless-executor"; return "operator"; }
function isAlreadyComplete(name: QueueName, status: number): boolean { return name === "activate-node" ? status >= 2 : name === "submit-deliverable" ? status >= 4 : name === "complete-job" ? status === 5 : name === "reject-job" ? [6, 7, 8].includes(status) : false; }
function workflowStatusLabel(code: number): string { return workflowStatusLabels[code] ?? `Unknown(${code})`; }
function stableId(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)).digest("hex"); }
function jsonValue(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue; }
function sanitizeError(error: unknown): string { return (error instanceof Error ? error.message : "unknown worker error").replace(/(token|secret|password|private.?key)\s*[=:]\s*\S+/gi, "$1=[redacted]").slice(0, 2_000); }
export function outcomePersistence(outcome: Extract<ProcessorOutcome, { status: "waiting" }>, now: Date, defaultRetrySeconds: number) {
  const retryAfterSeconds = outcome.retryable ? outcome.retryAfterSeconds ?? defaultRetrySeconds : undefined;
  return { status: "waiting", waitingReason: outcome.reason, nextAttemptAt: retryAfterSeconds === undefined ? null : new Date(now.getTime() + retryAfterSeconds * 1_000), lastResult: outcome as Prisma.InputJsonValue, lastError: null } as const;
}
