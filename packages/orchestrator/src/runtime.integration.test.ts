import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, stringToHex, type Abi, type Address, type Hash } from "viem";
import { arcTestnet, policyRegistryAbi, workflowCoordinatorAbi, workflowFactoryAbi } from "@agentsaga/contracts";
import { prisma } from "./postgres.js";
import { QueueRuntime } from "./queues.js";
import { WorkerRuntime } from "./worker-runtime.js";
import { SignerRegistry } from "./signer-registry.js";
import type { ContractWriteRequest, TransactionSigner } from "./transaction-signer.js";
import { loadConfig } from "./config.js";
import { defaultCapabilities } from "./capabilities.js";
import { WaitingActionScheduler } from "./waiting-action-scheduler.js";
import type { Job } from "bullmq";

const integration = process.env.RUN_INTEGRATION === "1" ? describe : describe.skip;
const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";

integration("PostgreSQL + Redis + Anvil lifecycle", () => {
  let queues: QueueRuntime; let workflow: Address; let account: Address; let publicClient: ReturnType<typeof createPublicClient>; let wallet: ReturnType<typeof createWalletClient>; let signers: SignerRegistry; let scheduler: WaitingActionScheduler; let signer: TransactionSigner; let runtime: WorkerRuntime;
  beforeAll(async () => {
    publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
    [account] = await publicClient.request({ method: "eth_accounts" });
    wallet = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) });
    const loadArtifact = async (name: string) => JSON.parse(await readFile(resolve(process.cwd(), `../../out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: `0x${string}` } };
    const deploy = async (name: string, args: readonly unknown[] = []) => { const artifact = await loadArtifact(name); const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }); const receipt = await publicClient.waitForTransactionReceipt({ hash }); if (!receipt.contractAddress) throw new Error(`${name} deployment failed`); return receipt.contractAddress; };
    const usdc = await deploy("MockUSDC");
    const policy = await deploy("PolicyRegistry", [account, account, usdc]);
    const factory = await deploy("WorkflowFactory", [policy]);
    const receiptRegistry = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "receiptRegistry" });
    const now = Number((await publicClient.getBlock()).timestamp);
    const nodes = [{ provider: account, evaluator: account, budget: 100_000_000n, compensationBudget: 0n, expiry: now + 86_400, dependencyMask: 0, specificationHash: keccak256(stringToHex("integration-node")), compensationSpecificationHash: `0x${"00".repeat(32)}`, compensationType: 0, humanApprovalRequired: true, metadataURI: "urn:agentsaga:integration" }];
    const createHash = await wallet.writeContract({ address: factory, abi: workflowFactoryAbi, functionName: "createWorkflow", args: [usdc, 100_000_000n, 0n, now + 172_800, keccak256(stringToHex("integration-dag")), "urn:agentsaga:integration", keccak256(stringToHex("integration-salt")), nodes] });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    const created = createReceipt.logs.find((log) => log.address.toLowerCase() === factory.toLowerCase());
    if (!created) throw new Error("WorkflowCreated log missing");
    workflow = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "workflowById", args: [0n] });
    const mock = await loadArtifact("MockUSDC");
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mock.abi, functionName: "mint", args: [account, 100_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mock.abi, functionName: "approve", args: [workflow, 100_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "fund" }) });
    await prisma.$transaction([prisma.deadLetterRecord.deleteMany(), prisma.workerAction.deleteMany(), prisma.evaluatorDecision.deleteMany(), prisma.agentExecution.deleteMany(), prisma.workflowJob.deleteMany(), prisma.workflowNode.deleteMany(), prisma.chainTransaction.deleteMany(), prisma.evidenceRecord.deleteMany(), prisma.workflow.deleteMany()]);
    await prisma.workflow.create({ data: { address: workflow.toLowerCase(), chainId: arcTestnet.id, owner: account.toLowerCase(), paymentToken: usdc.toLowerCase(), status: "Active", statusCode: 2, statusLabel: "Active", totalBudget: "100000000", nodeCount: 1, createdBlock: createReceipt.blockNumber, state: {} } });
    signer = { address: async () => account, status: async () => "ready", sendContractTransaction: async (request: ContractWriteRequest): Promise<Hash> => wallet.sendTransaction({ account, chain: arcTestnet, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) }) };
    signers = new SignerRegistry();
    queues = new QueueRuntime(process.env.REDIS_URL!); await queues.connection.flushdb();
    const capabilities = defaultCapabilities("autonomous"); for (const key of Object.keys(capabilities) as Array<keyof typeof capabilities>) capabilities[key] = "ready";
    runtime = new WorkerRuntime(queues, loadConfig({ NODE_ENV: "test", ARC_TESTNET_RPC_URL: rpcUrl, DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, OPERATION_MODE: "autonomous", RECEIPT_REGISTRY_ADDRESS: receiptRegistry }), signers, capabilities); runtime.registerAll();
    await queues.waitUntilReady();
    scheduler = new WaitingActionScheduler(prisma, queues);
  }, 60_000);

  afterAll(async () => { await queues?.close(); await prisma.$disconnect(); });

  it("durably resumes human approval and signer waiting before executing once", async () => {
    await queues.enqueue("discover-ready-nodes", `${workflow}:discover`, { workflow });
    const activationKey = `${workflow.toLowerCase()}:0:activate-node`;
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => action?.waitingReason), { timeout: 10_000 }).toBe("human_approval");
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "approveNode", args: [0] }) });
    await scheduler.resumeForEvent({ workflow, nodeId: 0, reasons: ["human_approval"] }); await scheduler.runOnce();
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => action?.waitingReason), { timeout: 10_000 }).toBe("role_signer");
    await queues.pauseWorkers();
    await Promise.all((["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "permissionless-executor"] as const).map((role) => signers.register({ workflow, role }, signer)));
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => Boolean(action?.nextAttemptAt && action.nextAttemptAt <= new Date())), { timeout: 5_000 }).toBe(true);
    await scheduler.runOnce();
    for (const name of ["activate-node", "execute-agent", "submit-deliverable", "evaluate-job", "complete-job"] as const) {
      await expect.poll(async () => prisma.workerAction.findFirst({ where: { workflow: workflow.toLowerCase(), action: name } }), { timeout: 10_000 }).toBeTruthy();
      const action = await prisma.workerAction.findFirstOrThrow({ where: { workflow: workflow.toLowerCase(), action: name } });
      if (!["completed", "already_complete"].includes(action.status)) await runtime.process(name, { id: `${name}-integration`, data: { ...(action.payload as object), logicalActionKey: action.idempotencyKey, actionId: action.id, resumeSequence: action.resumeSequence, executionAttempt: action.executionAttempts }, attemptsMade: action.executionAttempts, opts: { attempts: 7 } } as Job);
    }
    await expect.poll(async () => publicClient.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), { timeout: 30_000 }).toBe(true);
    await runtime.process("build-receipt-index", { id: "receipt-integration", data: { workflow }, attemptsMade: 0, opts: { attempts: 7 } } as Job);
    await expect.poll(async () => prisma.evidenceRecord.count({ where: { workflowAddress: workflow.toLowerCase(), kind: "workflow-receipt" } }), { timeout: 10_000 }).toBe(1);
    const actions = await prisma.workerAction.findMany({ where: { workflow: workflow.toLowerCase() } });
    expect(actions.filter((action) => action.transactionHash)).toHaveLength(3);
    expect(new Set(actions.filter((action) => action.transactionHash).map((action) => action.transactionHash)).size).toBe(3);
    expect(await prisma.deadLetterRecord.count()).toBe(0);
    const activation = actions.find((action) => action.action === "activate-node"); expect(activation).toMatchObject({ executionAttempts: 0, resumeAttempts: 2, status: "completed" });
  }, 40_000);

  it("survives scheduler restart and concurrent claims without duplicate execution", async () => {
    const idempotencyKey = `${workflow}:restart-reconcile`;
    await prisma.workerAction.create({ data: { id: "restart-reconcile", workflow: workflow.toLowerCase(), action: "reconcile-state", idempotencyKey, status: "waiting", waitingReason: "external_service", nextAttemptAt: new Date(), payload: { workflow } } });
    const [first, second] = await Promise.all([new WaitingActionScheduler(prisma, queues).runOnce(), new WaitingActionScheduler(prisma, queues).runOnce()]);
    expect(first + second).toBe(1);
    const action = await prisma.workerAction.findUniqueOrThrow({ where: { id: "restart-reconcile" } });
    await runtime.process("reconcile-state", { id: "restart-reconcile-integration", data: { ...(action.payload as object), logicalActionKey: action.idempotencyKey, actionId: action.id, resumeSequence: action.resumeSequence, executionAttempt: action.executionAttempts }, attemptsMade: 0, opts: { attempts: 7 } } as Job);
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { id: "restart-reconcile" } }).then((action) => action?.status), { timeout: 10_000 }).toBe("completed");
    expect(await prisma.workerAction.count({ where: { idempotencyKey } })).toBe(1);
  });
});
