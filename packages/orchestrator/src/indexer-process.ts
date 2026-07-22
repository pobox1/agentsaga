import { createPublicClient, http, type Address, type Log } from "viem";
import { arcTestnet, workflowCoordinatorAbi } from "@agentsaga/contracts";
import { loadConfig } from "./config.js";
import { ArcEventIndexer, decodeTrackedEvent } from "./indexer.js";
import { PostgresCursorStore, prisma } from "./postgres.js";
import { Prisma } from "@prisma/client";

const config = loadConfig();
if (!config.DATABASE_URL || !config.WORKFLOW_FACTORY_ADDRESS || config.FACTORY_DEPLOYMENT_BLOCK === undefined) throw new Error("Indexer requires DATABASE_URL, WORKFLOW_FACTORY_ADDRESS and FACTORY_DEPLOYMENT_BLOCK");
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
  await prisma.chainTransaction.upsert({ where: { hash: log.transactionHash }, create: { hash: log.transactionHash, workflowAddress: workflow, chainId: arcTestnet.id, action: decoded.eventName, status: "confirmed", blockNumber: log.blockNumber, toAddress: log.address.toLowerCase(), payload, submittedAt: new Date(), confirmedAt: new Date() }, update: { status: "confirmed", blockNumber: log.blockNumber, confirmedAt: new Date() } });
  if (decoded.eventName === "WorkflowFunded") await prisma.workflow.update({ where: { address: workflow }, data: { status: "funded" } });
  if (decoded.eventName === "WorkflowStatusChanged") await prisma.workflow.update({ where: { address: workflow }, data: { status: String(args.current) } });
  const nodeId = args.nodeId === undefined ? undefined : Number(args.nodeId);
  if (nodeId !== undefined) await prisma.workflowNode.upsert({ where: { workflowAddress_nodeId: { workflowAddress: workflow, nodeId } }, create: { id: `${workflow}:${nodeId}`, workflowAddress: workflow, nodeId, status: decoded.eventName, jobId: args.jobId === undefined ? null : String(args.jobId), provider: args.provider === undefined ? null : String(args.provider).toLowerCase(), state: payload }, update: { status: decoded.eventName, ...(args.jobId === undefined ? {} : { jobId: String(args.jobId) }), state: payload } });
  if (nodeId === undefined && args.jobId !== undefined) {
    const mapped = await prisma.workflowNode.findFirst({ where: { workflowAddress: workflow, jobId: String(args.jobId) } });
    if (mapped) await prisma.workflowNode.update({ where: { id: mapped.id }, data: { status: decoded.eventName, state: payload } });
  }
  if (decoded.eventName === "WorkflowReceiptFinalized") await prisma.evidenceRecord.upsert({ where: { id: `${workflow}:receipt` }, create: { id: `${workflow}:receipt`, workflowAddress: workflow, kind: "workflow-receipt", commitment: String(args.evidenceAccumulator ?? log.transactionHash), transactionHash: log.transactionHash, metadata: payload }, update: { transactionHash: log.transactionHash, metadata: payload } });
}

const factoryIndexer = new ArcEventIndexer({ id: `arc:${arcTestnet.id}:factory:${factory.toLowerCase()}`, addresses: [factory], startBlock: config.FACTORY_DEPLOYMENT_BLOCK, rpcUrl: config.ARC_TESTNET_RPC_URL }, new PostgresCursorStore(arcTestnet.id), async (log) => {
  const decoded = decodeTrackedEvent(log); if (decoded?.eventName !== "WorkflowCreated" || !log.blockNumber) return;
  const args = decoded.payload.args as Record<string, unknown>; const workflow = String(args.workflow).toLowerCase() as Address;
  await prisma.workflow.upsert({ where: { address: workflow }, create: { address: workflow, chainId: arcTestnet.id, owner: String(args.owner).toLowerCase(), status: "created", createdBlock: log.blockNumber, state: { workflowId: String(args.workflowId), specificationHash: String(args.workflowSpecificationHash), creationTransaction: log.transactionHash } }, update: {} });
  await addWorkflow(workflow, log.blockNumber);
});
const receiptIndexer = config.RECEIPT_REGISTRY_ADDRESS ? new ArcEventIndexer({ id: `arc:${arcTestnet.id}:receipts:${config.RECEIPT_REGISTRY_ADDRESS.toLowerCase()}`, addresses: [config.RECEIPT_REGISTRY_ADDRESS as Address], startBlock: config.FACTORY_DEPLOYMENT_BLOCK, rpcUrl: config.ARC_TESTNET_RPC_URL }, new PostgresCursorStore(arcTestnet.id), async (log) => {
  const decoded = decodeTrackedEvent(log); if (decoded?.eventName !== "WorkflowReceiptFinalized") return;
  const args = decoded.payload.args as Record<string, unknown>; if (typeof args.workflow !== "string") return;
  const workflow = args.workflow.toLowerCase();
  if (await prisma.workflow.findUnique({ where: { address: workflow } })) await indexWorkflowLog(workflow, log);
}) : undefined;

for (const row of await prisma.workflow.findMany({ select: { address: true, createdBlock: true } })) await addWorkflow(row.address as Address, row.createdBlock);
let stopping = false;
const close = async () => { stopping = true; await prisma.$disconnect(); process.exit(0); };
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
while (!stopping) { await factoryIndexer.syncOnce(); for (const indexer of workflowIndexers.values()) await indexer.syncOnce(); await receiptIndexer?.syncOnce(); await new Promise((resolve) => setTimeout(resolve, 5_000)); }
