import { createPublicClient, http, type Address, type Log } from "viem";
import { agentJobAdapterAbi, arcTestnet, receiptRegistryAbi, workflowCoordinatorAbi, workflowStatusLabels } from "@agentsaga/contracts";
import { loadConfig } from "./config.js";
import { appendTransactionEvent, ArcEventIndexer, decodeTrackedEvent, resumeWaitingActionsForProjectedEvent, workflowJobType, workflowStatusUpdate } from "./indexer.js";
import { PostgresCursorStore, prisma } from "./postgres.js";
import { Prisma } from "@prisma/client";
import IORedis from "ioredis";
import { loadCapabilityConfiguration } from "./capabilities.js";
import { publishProcessHeartbeat } from "./runtime-heartbeat.js";

const config = loadConfig();
if (!config.DATABASE_URL || !config.REDIS_URL || !config.WORKFLOW_FACTORY_ADDRESS || config.FACTORY_DEPLOYMENT_BLOCK === undefined) throw new Error("Indexer requires DATABASE_URL, REDIS_URL, WORKFLOW_FACTORY_ADDRESS and FACTORY_DEPLOYMENT_BLOCK");
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
const capabilityConfiguration = loadCapabilityConfiguration(config.OPERATION_MODE, config.RUNTIME_CAPABILITIES_JSON);
const factory = config.WORKFLOW_FACTORY_ADDRESS as Address;
const rpc = createPublicClient({ chain: arcTestnet, transport: http(config.ARC_TESTNET_RPC_URL) });
const workflowIndexers = new Map<string, ArcEventIndexer>();

async function addWorkflow(workflow: Address, createdBlock: bigint): Promise<void> {
  const address = workflow.toLowerCase();
  if (workflowIndexers.has(address)) return;
  const coordinatorAdapter = await rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "jobAdapter" });
  const addresses = [workflow, coordinatorAdapter];
  workflowIndexers.set(address, new ArcEventIndexer({ id: `arc:${arcTestnet.id}:workflow:${address}`, addresses, startBlock: createdBlock, rpcUrl: config.ARC_TESTNET_RPC_URL }, new PostgresCursorStore(arcTestnet.id), (log) => indexWorkflowLog(address, log)));
}

async function indexWorkflowLog(workflow: string, log: Log): Promise<void> {
  const decoded = decodeTrackedEvent(log); if (!decoded || !log.transactionHash) return;
  const args = decoded.payload.args as Record<string, unknown>;
  const payload = decoded.payload as Prisma.InputJsonValue;
  const transaction = await prisma.chainTransaction.findUnique({ where: { hash: log.transactionHash } });
  const transactionPayload = appendTransactionEvent(transaction?.payload, { eventName: decoded.eventName, logIndex: log.logIndex, emitter: log.address.toLowerCase() }) as Prisma.InputJsonValue;
  await prisma.chainTransaction.upsert({ where: { hash: log.transactionHash }, create: { hash: log.transactionHash, workflowAddress: workflow, chainId: arcTestnet.id, action: "multi-event", status: "confirmed", blockNumber: log.blockNumber, toAddress: log.address.toLowerCase(), payload: transactionPayload, submittedAt: new Date(), confirmedAt: new Date() }, update: { action: "multi-event", status: "confirmed", blockNumber: log.blockNumber, confirmedAt: new Date(), payload: transactionPayload } });
  if (decoded.eventName === "WorkflowFunded") {
    const current = await prisma.workflow.findUniqueOrThrow({ where: { address: workflow } });
    await prisma.workflow.update({ where: { address: workflow }, data: { state: { ...(current.state as Record<string, unknown>), deposited: args.amount ?? args.deposited ?? null, fundedAt: new Date().toISOString(), fundingTransaction: log.transactionHash } } });
  }
  const statusUpdate = workflowStatusUpdate(decoded.eventName, args.current);
  if (statusUpdate) await prisma.workflow.update({ where: { address: workflow }, data: statusUpdate });
  const nodeId = args.nodeId === undefined ? undefined : Number(args.nodeId);
  if (nodeId !== undefined) await prisma.workflowNode.upsert({ where: { workflowAddress_nodeId: { workflowAddress: workflow, nodeId } }, create: { id: `${workflow}:${nodeId}`, workflowAddress: workflow, nodeId, status: decoded.eventName, jobId: args.jobId === undefined ? null : String(args.jobId), provider: args.provider === undefined ? null : String(args.provider).toLowerCase(), evaluator: args.evaluator === undefined ? null : String(args.evaluator).toLowerCase(), state: payload }, update: { status: decoded.eventName, ...(args.jobId === undefined ? {} : { jobId: String(args.jobId) }), ...(args.provider === undefined ? {} : { provider: String(args.provider).toLowerCase() }), ...(args.evaluator === undefined ? {} : { evaluator: String(args.evaluator).toLowerCase() }), state: payload } });
  if (nodeId !== undefined && args.jobId !== undefined) {
    const adapter = await rpc.readContract({ address: workflow as Address, abi: workflowCoordinatorAbi, functionName: "jobAdapter" });
    const job = await rpc.readContract({ address: adapter, abi: agentJobAdapterAbi, functionName: "getJob", args: [BigInt(String(args.jobId))] });
    await prisma.workflowJob.upsert({
      where: { workflowAddress_jobId: { workflowAddress: workflow, jobId: String(args.jobId) } },
      create: { id: `${workflow}:${args.jobId}`, workflowAddress: workflow, nodeId, jobId: String(args.jobId), jobType: workflowJobType(decoded.eventName), provider: job.provider.toLowerCase(), evaluator: job.evaluator.toLowerCase(), budget: job.budget.toString(), expiry: new Date(Number(job.expiredAt) * 1_000), specificationHash: job.specificationHash, status: decoded.eventName, createdBlock: log.blockNumber ?? 0n, state: payload },
      update: { provider: job.provider.toLowerCase(), evaluator: job.evaluator.toLowerCase(), budget: job.budget.toString(), expiry: new Date(Number(job.expiredAt) * 1_000), specificationHash: job.specificationHash, status: decoded.eventName, state: payload },
    });
  }
  if (nodeId === undefined && args.jobId !== undefined) {
    const mappedJob = await prisma.workflowJob.findUnique({ where: { workflowAddress_jobId: { workflowAddress: workflow, jobId: String(args.jobId) } } });
    if (mappedJob) {
      const job = await rpc.readContract({ address: log.address, abi: agentJobAdapterAbi, functionName: "getJob", args: [BigInt(String(args.jobId))] });
      await prisma.workflowJob.update({ where: { id: mappedJob.id }, data: { provider: job.provider.toLowerCase(), evaluator: job.evaluator.toLowerCase(), budget: job.budget.toString(), expiry: new Date(Number(job.expiredAt) * 1_000), specificationHash: job.specificationHash, status: decoded.eventName, state: payload } });
      await prisma.workflowNode.update({ where: { workflowAddress_nodeId: { workflowAddress: workflow, nodeId: mappedJob.nodeId } }, data: { status: decoded.eventName, state: payload } });
    }
  }
  await resumeWaitingActionsForProjectedEvent(prisma, workflow, decoded.eventName, nodeId);
  if (decoded.eventName === "WorkflowReceiptFinalized" && config.RECEIPT_REGISTRY_ADDRESS) {
    const receipt = await rpc.readContract({ address: config.RECEIPT_REGISTRY_ADDRESS as Address, abi: receiptRegistryAbi, functionName: "getReceipt", args: [workflow as Address] });
    await prisma.evidenceRecord.upsert({ where: { id: `${workflow}:receipt` }, create: { id: `${workflow}:receipt`, workflowAddress: workflow, kind: "workflow-receipt", commitment: String(args.evidenceAccumulator ?? log.transactionHash), transactionHash: log.transactionHash, metadata: jsonValue(receipt) }, update: { transactionHash: log.transactionHash, metadata: jsonValue(receipt) } });
  }
  if (["WorkflowFunded", "WorkflowStatusChanged", "NodeActivated", "NodeCompleted", "NodeRejected", "NodeSkipped", "CompensationCompleted", "CompensationUnresolved", "Refunded"].includes(decoded.eventName)) await reconcileWorkflow(workflow as Address);
}

async function reconcileWorkflow(workflow: Address): Promise<void> {
  const [status, finalized, deposited, completedMask, failedMask, skippedMask, compensationPendingMask, compensatedMask, compensationUnresolvedMask] = await Promise.all([
    rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "status" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "deposited" }),
    rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "completedMask" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "failedMask" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "skippedMask" }),
    rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensatedMask" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "compensationUnresolvedMask" }),
  ]);
  const statusCode = Number(status); const statusLabel = workflowStatusLabels[statusCode] ?? `Unknown(${statusCode})`;
  const current = await prisma.workflow.findUniqueOrThrow({ where: { address: workflow.toLowerCase() } });
  const reconciled = JSON.parse(JSON.stringify({ finalized, deposited, completedMask, failedMask, skippedMask, compensationPendingMask, compensatedMask, compensationUnresolvedMask }, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Record<string, unknown>;
  await prisma.workflow.update({ where: { address: workflow.toLowerCase() }, data: { status: statusLabel, statusCode, statusLabel, state: { ...(current.state as Record<string, unknown>), ...reconciled, reconciledAt: new Date().toISOString() } } });
}

const factoryIndexer = new ArcEventIndexer({ id: `arc:${arcTestnet.id}:factory:${factory.toLowerCase()}`, addresses: [factory], startBlock: config.FACTORY_DEPLOYMENT_BLOCK, rpcUrl: config.ARC_TESTNET_RPC_URL }, new PostgresCursorStore(arcTestnet.id), async (log) => {
  const decoded = decodeTrackedEvent(log); if (decoded?.eventName !== "WorkflowCreated" || !log.blockNumber) return;
  const args = decoded.payload.args as Record<string, unknown>; const workflow = String(args.workflow).toLowerCase() as Address;
  const [owner, paymentToken, totalBudget, nodeCount, jobAdapter, status, specificationHash] = await Promise.all([
    rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "owner" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "paymentToken" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "totalBudget" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "nodeCount" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "jobAdapter" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "status" }), rpc.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "workflowSpecificationHash" }),
  ]);
  const statusCode = Number(status); const statusLabel = workflowStatusLabels[statusCode] ?? `Unknown(${statusCode})`;
  await prisma.workflow.upsert({ where: { address: workflow }, create: { address: workflow, chainId: arcTestnet.id, owner: owner.toLowerCase(), paymentToken: paymentToken.toLowerCase(), status: statusLabel, statusCode, statusLabel, totalBudget: totalBudget.toString(), nodeCount: Number(nodeCount), createdBlock: log.blockNumber, state: { workflowId: String(args.workflowId), specificationHash: String(specificationHash), factoryAddress: factory.toLowerCase(), jobAdapter: jobAdapter.toLowerCase(), creationTransaction: log.transactionHash, creationBlock: log.blockNumber.toString() } }, update: {} });
  await addWorkflow(workflow, log.blockNumber);
});
const receiptIndexer = config.RECEIPT_REGISTRY_ADDRESS ? new ArcEventIndexer({ id: `arc:${arcTestnet.id}:receipts:${config.RECEIPT_REGISTRY_ADDRESS.toLowerCase()}`, addresses: [config.RECEIPT_REGISTRY_ADDRESS as Address], startBlock: config.FACTORY_DEPLOYMENT_BLOCK, rpcUrl: config.ARC_TESTNET_RPC_URL }, new PostgresCursorStore(arcTestnet.id), async (log) => {
  const decoded = decodeTrackedEvent(log); if (decoded?.eventName !== "WorkflowReceiptFinalized") return;
  const args = decoded.payload.args as Record<string, unknown>; if (typeof args.workflow !== "string") return;
  const workflow = args.workflow.toLowerCase();
  if (!(await prisma.workflow.findUnique({ where: { address: workflow } }))) {
    throw new Error(`Receipt projection dependency is not ready: workflow ${workflow} has not been projected`);
  }
  await indexWorkflowLog(workflow, log);
}) : undefined;

for (const row of await prisma.workflow.findMany({ select: { address: true, createdBlock: true } })) await addWorkflow(row.address as Address, row.createdBlock);
let stopping = false;
const close = async () => { stopping = true; await redis.quit(); await prisma.$disconnect(); };
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
while (!stopping) {
  try {
    await factoryIndexer.syncOnce();
    for (const indexer of workflowIndexers.values()) await indexer.syncOnce();
    await receiptIndexer?.syncOnce();
    await publishProcessHeartbeat(redis, "indexer", capabilityConfiguration, config.GIT_COMMIT_SHA, config.HEARTBEAT_STALE_SECONDS);
  } catch (error) {
    process.stderr.write(`Indexer cycle failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

function jsonValue(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue; }
