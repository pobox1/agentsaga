import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import { createPublicClient, encodeFunctionData, http, type Address, type Hash, type PublicClient } from "viem";
import { agentJobAdapterAbi, arcTestnet, receiptRegistryAbi, workflowCoordinatorAbi, workflowStatusLabels } from "@agentsaga/contracts";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { OrchestratorConfig } from "./config.js";
import { prisma } from "./postgres.js";
import { QueueRuntime, queueNames, type ProcessorRuntimeFact, type QueueName } from "./queues.js";
import { createDemoAgents } from "./agents.js";
import { DeterministicSchemaEvaluator } from "./evaluators.js";
import { defaultCapabilities, processorCapability, type RuntimeCapabilities } from "./capabilities.js";
import { SignerRegistry, type SignerRole } from "./signer-registry.js";
import type { ContractWriteRequest } from "./transaction-signer.js";
import type { WorkflowAgent } from "./types.js";

const payloadSchema = z.object({
  workflow: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nodeId: z.number().int().min(0).max(15).optional(),
  logicalActionKey: z.string().optional(), actionId: z.string().optional(), resumeSequence: z.number().int().nonnegative().optional(), executionAttempt: z.number().int().nonnegative().optional(),
  agentId: z.string().optional(), reasonHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), evaluator: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), deadline: z.number().int().positive().optional(),
  jobId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  jobType: z.enum(["service", "compensation"]).optional(),
}).passthrough();
type ActionPayload = z.infer<typeof payloadSchema> & { workflow: Address };
type JobContext = {
  jobId: bigint;
  jobType: "service" | "compensation";
  provider: Address;
  evaluator: Address;
  budget: bigint;
  expiry: bigint;
  status: number;
  specificationHash: Hash;
};

export type ProcessorOutcome =
  | { status: "complete"; detail?: string; enqueued?: number }
  | { status: "already_complete"; detail?: string }
  | { status: "waiting"; reason: "human_approval" | "role_signer" | "agent_adapter" | "evaluator_adapter" | "circle_auth" | "external_service" | "upstream_artifact" | "workflow_state" | "not_yet_due"; retryable: boolean; retryAfterSeconds?: number; detail: string }
  | { status: "blocked"; reason: "configuration_error" | "unsupported_action" | "invalid_workflow" | "invalid_role" | "permanent_external_failure"; detail: string };

export class WorkerRuntime {
  private readonly client: PublicClient;
  private readonly capabilities: RuntimeCapabilities;
  constructor(
    readonly queues: QueueRuntime,
    private readonly config: OrchestratorConfig,
    private readonly signers = new SignerRegistry(),
    capabilities?: RuntimeCapabilities,
    client?: PublicClient,
    private readonly agents: WorkflowAgent[] = createDemoAgents(),
  ) {
    this.client = client ?? createPublicClient({ chain: arcTestnet, transport: http(config.ARC_TESTNET_RPC_URL) });
    this.capabilities = capabilities ?? defaultCapabilities(config.OPERATION_MODE);
    this.signers.onRegistered(async (scope) => { await prisma.workerAction.updateMany({ where: { workflow: scope.workflow.toLowerCase(), status: "waiting", waitingReason: "role_signer", ...(scope.nodeId === undefined ? {} : { nodeId: scope.nodeId }) }, data: { nextAttemptAt: new Date() } }); });
  }

  registerAll(): void {
    this.queues.setProcessorFactProvider(() => this.factualProcessorCapabilities());
    for (const name of queueNames) this.queues.register(name, (job) => this.process(name, job), processorCapability(name, this.capabilities));
  }

  async factualProcessorCapabilities(): Promise<Record<QueueName, ProcessorRuntimeFact>> {
    const signerFacts = await this.signers.facts();
    const signerRoles: Partial<Record<QueueName, SignerRole>> = {
      "activate-node": "operator",
      "submit-deliverable": "provider",
      "complete-job": "evaluator",
      "reject-job": "evaluator",
      "open-compensation": "workflow-owner",
      "expire-job": "permissionless-executor",
      "expire-compensation": "permissionless-executor",
      "expire-workflow": "permissionless-executor",
    };
    return Object.fromEntries(queueNames.map((name): [QueueName, ProcessorRuntimeFact] => {
      const configuredCapability = processorCapability(name, this.capabilities);
      const signerRole = signerRoles[name];
      const signer = signerRole ? signerFacts[signerRole] : undefined;
      const additionalSignerFacts = name === "submit-deliverable"
        ? [signerFacts.provider, signerFacts["compensation-provider"]]
        : name === "complete-job" || name === "reject-job"
          ? [signerFacts.evaluator, signerFacts["compensation-evaluator"]]
          : name === "open-compensation"
            ? [signerFacts["workflow-owner"], signerFacts["compensation-provider"], signerFacts["compensation-evaluator"]]
            : signer ? [signer] : [];
      const adapterRequired = name === "execute-agent" || name === "execute-compensation" || name === "evaluate-job";
      const adapterRegistered = name === "execute-agent"
        ? this.agents.some((agent) => !agent.capabilities.includes("remediation"))
        : name === "execute-compensation"
          ? this.agents.some((agent) => agent.capabilities.includes("remediation"))
          : name === "evaluate-job";
      const adapterAvailability = adapterRequired
        ? !adapterRegistered
          ? "missing" as const
          : configuredCapability === "ready"
            ? "ready" as const
            : configuredCapability === "manual"
              ? "manual" as const
              : "missing" as const
        : undefined;
      const dependencyReady = additionalSignerFacts.length
        ? additionalSignerFacts.every((fact) => fact.ready)
        : adapterRequired ? adapterAvailability === "ready" : true;
      const signerAvailability = signer
        ? signer.status === "blocked_external_auth" ? "waiting_auth" as const : signer.status
        : signerRole ? "missing" as const : undefined;
      return [name, {
        registered: true,
        configuredCapability,
        dependencyStatus: dependencyReady ? "ready" : signerAvailability === "waiting_auth" ? "waiting_auth" : signerAvailability === "manual" ? "manual" : "missing",
        ...(signerAvailability === undefined ? {} : { signerAvailability }),
        ...(signerRole === undefined ? {} : { signerRole }),
        ...(adapterAvailability === undefined ? {} : { adapterAvailability }),
        operational: configuredCapability === "ready" && dependencyReady,
        detail: dependencyReady ? "Runtime dependencies are factually ready" : "A required runtime dependency is not ready",
      }];
    })) as Record<QueueName, ProcessorRuntimeFact>;
  }

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
    const { context } = await this.readJobContext(payload);
    const executionType = compensation || context.jobType === "compensation" ? "compensation" : "service";
    const jobId = context.jobId.toString();
    const existing = await prisma.agentExecution.findUnique({
      where: { workflowAddress_nodeId_jobId_executionType: { workflowAddress: payload.workflow, nodeId: payload.nodeId, jobId, executionType } },
    });
    if (existing) return { status: "already_complete", detail: "Agent execution artifact already exists" };
    const selected = this.agents.find((agent) => agent.id === payload.agentId) ?? this.agents[compensation ? this.agents.length - 1 : payload.nodeId % (this.agents.length - 1)];
    if (!selected) return { status: "waiting", reason: "agent_adapter", retryable: true, detail: "No matching agent adapter is configured" };
    const input = { workflowId: payload.workflow, nodeId: payload.nodeId, specification: { compensation: executionType === "compensation", jobId, specificationHash: context.specificationHash }, dependencyEvidence: [], maximumCost: context.budget };
    const startedAt = new Date();
    const result = await selected.execute(input);
    await prisma.agentExecution.create({ data: { id: stableId(`${payload.workflow}:${payload.nodeId}:${jobId}:${executionType}`), workflowAddress: payload.workflow, nodeId: payload.nodeId, jobId, executionType, agentId: selected.id, status: "complete", input: jsonValue(input), output: jsonValue(result), evidenceHash: result.deliverableHash, cost: result.cost, startedAt, completedAt: new Date(result.completedAt) } });
    await this.persistWorkflowJob(payload.workflow, payload.nodeId, context);
    await this.enqueueNext("submit-deliverable", this.withJobContext(payload, context, result.deliverableHash));
    return { status: "complete", detail: `${selected.id} produced ${result.deliverableHash}`, enqueued: 1 };
  }

  private async evaluate(payload: ActionPayload): Promise<ProcessorOutcome> {
    if (payload.nodeId === undefined) return { status: "blocked", reason: "invalid_workflow", detail: "Evaluation requires nodeId" };
    const { context } = await this.readJobContext(payload);
    const jobId = context.jobId.toString();
    const execution = await prisma.agentExecution.findUnique({
      where: { workflowAddress_nodeId_jobId_executionType: { workflowAddress: payload.workflow, nodeId: payload.nodeId, jobId, executionType: context.jobType } },
    });
    if (!execution?.output) return { status: "waiting", reason: "upstream_artifact", retryable: true, detail: "Agent execution result is not stored" };
    const result = execution.output as unknown as Parameters<DeterministicSchemaEvaluator["evaluate"]>[0]["result"];
    const decision = await new DeterministicSchemaEvaluator().evaluate({ workflowId: payload.workflow, nodeId: payload.nodeId, result });
    await prisma.evaluatorDecision.upsert({ where: { id: stableId(`${payload.workflow}:${payload.nodeId}:${jobId}:${context.jobType}`) }, create: { id: stableId(`${payload.workflow}:${payload.nodeId}:${jobId}:${context.jobType}`), workflowAddress: payload.workflow, nodeId: payload.nodeId, jobId, executionType: context.jobType, evaluatorId: decision.evaluatorId, decision: decision.decision, reasonCode: decision.reasonCode, evidenceHash: decision.evidenceHash, evaluatedAt: new Date(decision.evaluatedAt) }, update: {} });
    await this.enqueueNext(decision.decision === "approve" ? "complete-job" : "reject-job", this.withJobContext(payload, context, decision.evidenceHash));
    return { status: "complete", detail: `Evaluator decision: ${decision.decision}`, enqueued: 1 };
  }

  private async executeWrite(name: QueueName, payload: ActionPayload): Promise<ProcessorOutcome> {
    if (payload.nodeId === undefined && !["expire-workflow"].includes(name)) return { status: "blocked", reason: "invalid_workflow", detail: `${name} requires nodeId` };
    const node = payload.nodeId === undefined ? undefined : await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [payload.nodeId] });
    const adapter = await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "jobAdapter" });
    const context = node && node.jobId !== undefined
      ? await this.jobContextFromNode(payload, adapter, node)
      : undefined;
    const logicalActionKey = payload.logicalActionKey ?? `${name}:${payload.workflow}:${payload.nodeId ?? "workflow"}`;
    const action = await prisma.workerAction.findUniqueOrThrow({ where: { idempotencyKey: logicalActionKey } });
    const stored = action.transactionHash
      ? await prisma.chainTransaction.findUnique({ where: { hash: action.transactionHash } })
      : await prisma.chainTransaction.findFirst({ where: { logicalActionKey, status: { notIn: ["reverted", "dropped", "replaced"] } }, orderBy: { submittedAt: "desc" } });
    if (!stored && await this.actionAlreadyComplete(name, payload, node, context)) return { status: "already_complete", detail: "Fresh onchain action-specific state is terminal" };
    if (name === "activate-node" && node && Number(node.status) === 0) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Node dependencies are not ready" };
    if (name === "complete-job" && context && [4, 5].includes(context.status)) return { status: "blocked", reason: "invalid_workflow", detail: "The active job was rejected or expired and cannot be completed" };
    if (name === "reject-job" && context && [3, 5].includes(context.status)) return { status: "blocked", reason: "invalid_workflow", detail: "The active job was completed or expired and cannot be rejected" };
    if (name === "activate-node" && node?.humanApprovalRequired && !node.humanApproved) return { status: "waiting", reason: "human_approval", retryable: false, detail: "NodeApproved is required before activation" };
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (name === "expire-job" && node && now < BigInt(node.expiry)) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(BigInt(node.expiry) - now), detail: "Job expiry is not yet due" };
    if (name === "expire-workflow") { const deadline = await this.readGlobalDeadline(payload.workflow); if (deadline !== undefined && now < deadline) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(deadline - now), detail: "Workflow expiry is not yet due" }; }
    if (name === "expire-compensation" && context && now < context.expiry) return { status: "waiting", reason: "not_yet_due", retryable: true, retryAfterSeconds: Number(context.expiry - now), detail: "Compensation expiry is not yet due" };
    if (name === "open-compensation" && payload.nodeId !== undefined) { const mask = Number(await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" })); const highest = mask === 0 ? -1 : 31 - Math.clz32(mask); if (highest !== payload.nodeId) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Compensation must proceed in reverse order" }; }
    if (name === "open-compensation" && node && Number(node.compensationType) !== 1) return { status: "waiting", reason: "human_approval", retryable: false, detail: "This compensation item requires explicit manual recovery" };
    if (name === "expire-workflow") { const [finalized, status, pendingMask] = await Promise.all([this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "status" }), this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" })]); if (finalized) return { status: "already_complete", detail: "Workflow is finalized" }; if (Number(status) === 4 || Number(pendingMask) !== 0) return { status: "waiting", reason: "workflow_state", retryable: true, detail: "Compensation must resolve before workflow expiry" }; }
    let effectivePayload = payload;
    if (name === "open-compensation" && payload.nodeId !== undefined) {
      const [provider, evaluator] = await Promise.all([
        this.signers.addressFor({ workflow: payload.workflow, nodeId: payload.nodeId, role: "compensation-provider" }),
        this.signers.addressFor({ workflow: payload.workflow, nodeId: payload.nodeId, role: "compensation-evaluator" }),
      ]);
      if (!provider || !evaluator) return { status: "waiting", reason: "role_signer", retryable: true, detail: "Compensation provider and evaluator signers are required before opening remediation" };
      effectivePayload = { ...payload, provider, evaluator, deadline: payload.deadline ?? Math.floor(Date.now() / 1_000) + 3_600 };
    }
    const role = signerRole(name, context);
    const expectedAddress = role === "provider" || role === "compensation-provider"
      ? context?.provider
      : role === "evaluator"
        ? context?.evaluator
        : role === "workflow-owner"
          ? await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "owner" })
          : undefined;
    const signer = await this.signers.resolve({ workflow: payload.workflow, ...(payload.nodeId === undefined ? {} : { nodeId: payload.nodeId }), role, ...(expectedAddress ? { expectedAddress } : {}) });
    if (!signer) return { status: "waiting", reason: "role_signer", retryable: true, detail: `A ready ${role} signer matching the fresh onchain role is required` };
    const request = writeRequest(name, effectivePayload, adapter, context?.jobId ?? node?.jobId);
    if (!request) return { status: "blocked", reason: "unsupported_action", detail: `${name} has no safe write mapping` };
    const sender = await signer.address();
    let hash: Hash;
    if (stored) {
      hash = stored.hash as Hash;
      if (!action.transactionHash) await prisma.workerAction.update({ where: { id: action.id }, data: { transactionHash: hash } });
    } else {
      await this.client.call({ account: sender, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) });
      await prisma.workerAction.update({ where: { id: action.id }, data: { signerRole: role, lastResult: { status: "prepared", sender, target: request.address } } });
      hash = await signer.sendContractTransaction(request);
      const submittedAt = new Date();
      await prisma.$transaction([
        prisma.workerAction.update({ where: { id: action.id }, data: { transactionHash: hash, transactionNonce: null, signerRole: role, lastResult: { status: "submitted", hash, sender, nonce: null } } }),
        prisma.chainTransaction.create({ data: { hash, workflowAddress: payload.workflow, chainId: arcTestnet.id, action: name, logicalActionKey, status: "submitted", fromAddress: sender.toLowerCase(), toAddress: request.address.toLowerCase(), transactionNonce: null, payload: jsonValue(effectivePayload), submittedAt } }),
      ]);
    }
    await this.enrichTransactionNonce(hash, action.id);
    await prisma.chainTransaction.update({
      where: { hash },
      data: { status: "confirming", lastCheckedAt: new Date() },
    });
    let receipt: Awaited<ReturnType<PublicClient["waitForTransactionReceipt"]>>;
    try {
      receipt = await this.client.waitForTransactionReceipt({ hash });
    } catch (error) {
      await prisma.chainTransaction.update({
        where: { hash },
        data: {
          status: "recovery_paused",
          recoveryAttempts: { increment: 1 },
          lastCheckedAt: new Date(),
          verificationResult: {
            action: name,
            receiptAvailable: false,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
      throw error;
    }
    if (receipt.status !== "success") {
      await prisma.chainTransaction.update({ where: { hash }, data: { status: "reverted", blockNumber: receipt.blockNumber, confirmedAt: new Date(), lastCheckedAt: new Date() } });
      throw new Error(`${name} transaction reverted`);
    }
    const verified = await this.actionAlreadyComplete(name, effectivePayload,
      payload.nodeId === undefined ? undefined : await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [payload.nodeId] }),
      payload.nodeId === undefined ? undefined : (await this.readJobContext(effectivePayload)).context,
    );
    const transactionStatus = verified ? "confirmed_state_verified" : "confirmed_verification_incomplete";
    await prisma.chainTransaction.update({ where: { hash }, data: { status: transactionStatus, blockNumber: receipt.blockNumber, confirmedAt: new Date(), lastCheckedAt: new Date(), verificationMethod: verified ? "state" : "incomplete", verificationResult: { action: name, verified } } });
    await this.advanceAfterWrite(name, effectivePayload);
    return { status: "complete", detail: `${name} ${transactionStatus} in ${hash}` };
  }

  private async enrichTransactionNonce(hash: Hash, actionId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const transaction = await this.client.getTransaction({ hash });
        await prisma.$transaction([
          prisma.workerAction.update({ where: { id: actionId }, data: { transactionNonce: transaction.nonce } }),
          prisma.chainTransaction.update({ where: { hash }, data: { transactionNonce: transaction.nonce, lastCheckedAt: new Date() } }),
        ]);
        return;
      } catch {
        await prisma.chainTransaction.update({ where: { hash }, data: { recoveryAttempts: { increment: 1 }, lastCheckedAt: new Date() } }).catch(() => undefined);
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }

  private async advanceAfterWrite(name: QueueName, payload: ActionPayload): Promise<void> {
    if (name === "activate-node") return this.enqueueNext("execute-agent", payload);
    if (name === "submit-deliverable") return this.enqueueNext("evaluate-job", payload);
    if (name === "open-compensation") {
      const { context } = await this.readJobContext({ ...payload, jobType: "compensation" });
      await this.persistWorkflowJob(payload.workflow, payload.nodeId!, context);
      return this.enqueueNext("execute-compensation", this.withJobContext(payload, context));
    }
    if (name === "complete-job" || name === "reject-job" || name === "expire-job" || name === "expire-compensation") {
      const jobType = payload.jobType ?? (await this.readJobContext(payload)).context.jobType;
      if (jobType === "compensation" || name === "expire-compensation") return this.continueCompensation(payload.workflow);
      if (name === "reject-job" || name === "expire-job") return this.continueCompensation(payload.workflow);
      const finalized = await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" });
      if (finalized) {
        await this.enqueueNext("reconcile-state", { workflow: payload.workflow } as ActionPayload);
        await this.enqueueNext("build-receipt-index", { workflow: payload.workflow } as ActionPayload);
      } else {
        await this.enqueueNext("discover-ready-nodes", payload);
      }
      return;
    }
    if (name === "expire-workflow") await this.enqueueNext("build-receipt-index", payload);
  }

  private async continueCompensation(workflow: Address): Promise<void> {
    const pendingMask = Number(await this.client.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }));
    if (pendingMask !== 0) {
      const nodeId = 31 - Math.clz32(pendingMask);
      await this.enqueueNext("open-compensation", { workflow, nodeId, jobType: "compensation" } as ActionPayload);
      return;
    }
    await this.enqueueNext("reconcile-state", { workflow } as ActionPayload);
    await this.enqueueNext("build-receipt-index", { workflow } as ActionPayload);
  }

  private async actionAlreadyComplete(name: QueueName, payload: ActionPayload, node?: Awaited<ReturnType<PublicClient["readContract"]>>, context?: JobContext): Promise<boolean> {
    if (name === "activate-node") return node !== undefined && [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(Number((node as { status: number }).status));
    if (name === "submit-deliverable") return context !== undefined && [2, 3, 4, 5].includes(context.status);
    if (name === "complete-job") return context?.status === 3;
    if (name === "reject-job") return context?.status === 4;
    if (name === "expire-job") return context !== undefined && [3, 4, 5].includes(context.status);
    if (name === "open-compensation") {
      if (payload.nodeId === undefined || node === undefined) return false;
      const pending = Number(await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }));
      return [9, 10, 7].includes(Number((node as { status: number }).status)) || (pending & (1 << payload.nodeId)) === 0;
    }
    if (name === "expire-compensation") {
      if (payload.nodeId === undefined) return false;
      const pending = Number(await this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }));
      return (pending & (1 << payload.nodeId)) === 0;
    }
    if (name === "expire-workflow") return this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "finalized" });
    return false;
  }

  private async readJobContext(payload: ActionPayload): Promise<{ context: JobContext; adapter: Address }> {
    if (payload.nodeId === undefined) throw new Error("Job context requires nodeId");
    const [node, adapter] = await Promise.all([
      this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "getNode", args: [payload.nodeId] }),
      this.client.readContract({ address: payload.workflow, abi: workflowCoordinatorAbi, functionName: "jobAdapter" }),
    ]);
    return { context: await this.jobContextFromNode(payload, adapter, node), adapter };
  }

  private async jobContextFromNode(payload: ActionPayload, adapter: Address, node: { jobId: bigint; status: number }): Promise<JobContext> {
    const jobId = payload.jobId === undefined ? node.jobId : BigInt(payload.jobId);
    const job = await this.client.readContract({ address: adapter, abi: agentJobAdapterAbi, functionName: "getJob", args: [jobId] });
    const jobType = payload.jobType ?? (Number(node.status) === 9 ? "compensation" : "service");
    return { jobId, jobType, provider: job.provider, evaluator: job.evaluator, budget: job.budget, expiry: BigInt(job.expiredAt), status: Number(job.status), specificationHash: job.specificationHash };
  }

  private withJobContext(payload: ActionPayload, context: JobContext, reasonHash?: Hash): ActionPayload {
    return { ...payload, jobId: context.jobId.toString(), jobType: context.jobType, provider: context.provider, evaluator: context.evaluator, deadline: Number(context.expiry), ...(reasonHash === undefined ? {} : { reasonHash }) };
  }

  private async persistWorkflowJob(workflow: Address, nodeId: number, context: JobContext): Promise<void> {
    await prisma.workflowJob.upsert({
      where: { workflowAddress_jobId: { workflowAddress: workflow, jobId: context.jobId.toString() } },
      create: { id: `${workflow}:${context.jobId}`, workflowAddress: workflow, nodeId, jobId: context.jobId.toString(), jobType: context.jobType, provider: context.provider.toLowerCase(), evaluator: context.evaluator.toLowerCase(), budget: context.budget.toString(), expiry: new Date(Number(context.expiry) * 1_000), specificationHash: context.specificationHash, status: String(context.status), createdBlock: 0n, state: jsonValue(context) },
      update: { provider: context.provider.toLowerCase(), evaluator: context.evaluator.toLowerCase(), budget: context.budget.toString(), expiry: new Date(Number(context.expiry) * 1_000), specificationHash: context.specificationHash, status: String(context.status), state: jsonValue(context) },
    });
  }

  private async enqueueNext(name: QueueName, payload: ActionPayload): Promise<void> {
    const phase = payload.jobType ? `:${payload.jobType}:${payload.jobId ?? "current"}` : "";
    const logicalKey = `${payload.workflow}:${payload.nodeId ?? "workflow"}:${name}${phase}`; const actionId = stableId(logicalKey);
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
function signerRole(name: QueueName, context?: JobContext): SignerRole {
  if (name === "submit-deliverable") return context?.jobType === "compensation" ? "compensation-provider" : "provider";
  if (name === "complete-job" || name === "reject-job") return context?.jobType === "compensation" ? "compensation-evaluator" : "evaluator";
  if (name === "open-compensation") return "workflow-owner";
  if (name.startsWith("expire-")) return "permissionless-executor";
  return "operator";
}
function workflowStatusLabel(code: number): string { return workflowStatusLabels[code] ?? `Unknown(${code})`; }
function stableId(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)).digest("hex"); }
function jsonValue(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue; }
function sanitizeError(error: unknown): string { return (error instanceof Error ? error.message : "unknown worker error").replace(/(token|secret|password|private.?key)\s*[=:]\s*\S+/gi, "$1=[redacted]").slice(0, 2_000); }
export function outcomePersistence(outcome: Extract<ProcessorOutcome, { status: "waiting" }>, now: Date, defaultRetrySeconds: number) {
  const retryAfterSeconds = outcome.retryable ? outcome.retryAfterSeconds ?? defaultRetrySeconds : undefined;
  return { status: "waiting", waitingReason: outcome.reason, nextAttemptAt: retryAfterSeconds === undefined ? null : new Date(now.getTime() + retryAfterSeconds * 1_000), lastResult: outcome as Prisma.InputJsonValue, lastError: null } as const;
}
