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
import { createDemoAgents } from "./agents.js";
import { PostgresCursorStore } from "./postgres.js";
import { projectPendingEvents } from "./indexer.js";
import type { Log } from "viem";

const integration = process.env.RUN_INTEGRATION === "1" ? describe : describe.skip;
const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";

integration("PostgreSQL + Redis + Anvil lifecycle", () => {
  let queues: QueueRuntime; let workflow: Address; let account: Address; let publicClient: ReturnType<typeof createPublicClient>; let wallet: ReturnType<typeof createWalletClient>; let signers: SignerRegistry; let scheduler: WaitingActionScheduler; let signer: TransactionSigner; let runtime: WorkerRuntime; let factory: Address; let usdc: Address; let mockAbi: Abi; let receiptRegistry: Address;
  beforeAll(async () => {
    publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
    [account] = await publicClient.request({ method: "eth_accounts" });
    wallet = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) });
    const loadArtifact = async (name: string) => JSON.parse(await readFile(resolve(process.cwd(), `../../out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: `0x${string}` } };
    const deploy = async (name: string, args: readonly unknown[] = []) => { const artifact = await loadArtifact(name); const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }); const receipt = await publicClient.waitForTransactionReceipt({ hash }); if (!receipt.contractAddress) throw new Error(`${name} deployment failed`); return receipt.contractAddress; };
    usdc = await deploy("MockUSDC");
    const policy = await deploy("PolicyRegistry", [account, account, usdc]);
    factory = await deploy("WorkflowFactory", [policy]);
    receiptRegistry = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "receiptRegistry" });
    const now = Number((await publicClient.getBlock()).timestamp);
    const nodes = [{ provider: account, evaluator: account, budget: 100_000_000n, compensationBudget: 0n, expiry: now + 86_400, dependencyMask: 0, specificationHash: keccak256(stringToHex("integration-node")), compensationSpecificationHash: `0x${"00".repeat(32)}`, compensationType: 0, humanApprovalRequired: true, metadataURI: "urn:agentsaga:integration" }];
    const createHash = await wallet.writeContract({ address: factory, abi: workflowFactoryAbi, functionName: "createWorkflow", args: [usdc, 100_000_000n, 0n, now + 172_800, keccak256(stringToHex("integration-dag")), "urn:agentsaga:integration", keccak256(stringToHex("integration-salt")), nodes] });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    const created = createReceipt.logs.find((log) => log.address.toLowerCase() === factory.toLowerCase());
    if (!created) throw new Error("WorkflowCreated log missing");
    workflow = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "workflowById", args: [0n] });
    const mock = await loadArtifact("MockUSDC"); mockAbi = mock.abi;
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "mint", args: [account, 100_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "approve", args: [workflow, 100_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "fund" }) });
    await prisma.$transaction([prisma.deadLetterRecord.deleteMany(), prisma.workerAction.deleteMany(), prisma.evaluatorDecision.deleteMany(), prisma.agentExecution.deleteMany(), prisma.workflowJob.deleteMany(), prisma.workflowNode.deleteMany(), prisma.chainTransaction.deleteMany(), prisma.evidenceRecord.deleteMany(), prisma.workflow.deleteMany()]);
    await prisma.workflow.create({ data: { address: workflow.toLowerCase(), chainId: arcTestnet.id, owner: account.toLowerCase(), paymentToken: usdc.toLowerCase(), status: "Active", statusCode: 2, statusLabel: "Active", totalBudget: "100000000", nodeCount: 1, createdBlock: createReceipt.blockNumber, state: {} } });
    signer = { address: async () => account, status: async () => "ready", sendContractTransaction: async (request: ContractWriteRequest): Promise<Hash> => wallet.sendTransaction({ account, chain: arcTestnet, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) }) };
    signers = new SignerRegistry();
    queues = new QueueRuntime(process.env.REDIS_URL!); await queues.connection.flushdb();
    const capabilities = defaultCapabilities("autonomous"); for (const key of Object.keys(capabilities) as Array<keyof typeof capabilities>) capabilities[key] = "ready";
    runtime = new WorkerRuntime(queues, loadConfig({ NODE_ENV: "test", ARC_TESTNET_RPC_URL: rpcUrl, DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, OPERATION_MODE: "autonomous", RECEIPT_REGISTRY_ADDRESS: receiptRegistry }), signers, capabilities, undefined, createDemoAgents(true)); runtime.registerAll();
    await queues.waitUntilReady();
    scheduler = new WaitingActionScheduler(prisma, queues);
  }, 60_000);

  afterAll(async () => { await queues?.close(); await prisma.$disconnect(); });

  it("runs the full success lifecycle through real BullMQ workers without direct processor calls", async () => {
    await queues.enqueue("discover-ready-nodes", `${workflow}:discover`, { workflow });
    const activationKey = `${workflow.toLowerCase()}:0:activate-node`;
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => action?.waitingReason), { timeout: 10_000 }).toBe("human_approval");
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "approveNode", args: [0] }) });
    await scheduler.resumeForEvent({ workflow, nodeId: 0, reasons: ["human_approval"] }); await scheduler.runOnce();
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => action?.waitingReason), { timeout: 10_000 }).toBe("role_signer");
    await Promise.all((["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "permissionless-executor"] as const).map((role) => signers.register({ workflow, role }, signer)));
    await expect.poll(async () => prisma.workerAction.findUnique({ where: { idempotencyKey: activationKey } }).then((action) => Boolean(action?.nextAttemptAt && action.nextAttemptAt <= new Date())), { timeout: 5_000 }).toBe(true);
    await scheduler.runOnce();
    await expect.poll(async () => publicClient.readContract({ address: workflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => prisma.evidenceRecord.count({ where: { workflowAddress: workflow.toLowerCase(), kind: "workflow-receipt" } }), { timeout: 10_000 }).toBe(1);
    const actions = await prisma.workerAction.findMany({ where: { workflow: workflow.toLowerCase() } });
    for (const name of ["activate-node", "execute-agent", "submit-deliverable", "evaluate-job", "complete-job", "reconcile-state", "build-receipt-index"] as const) {
      const matching = actions.filter((action) => action.action === name);
      expect(matching).toHaveLength(1);
      expect(["completed", "already_complete"]).toContain(matching[0]?.status);
    }
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

  it("automatically rejects a risk node and completes reverse-order remediation with distinct roles", async () => {
    const accounts = await publicClient.request({ method: "eth_accounts" });
    const compensationProvider = accounts[1]!;
    const compensationEvaluator = accounts[2]!;
    const now = Number((await publicClient.getBlock()).timestamp);
    const nodes = Array.from({ length: 5 }, (_, nodeId) => ({
      provider: account,
      evaluator: account,
      budget: 100_000_000n,
      compensationBudget: nodeId === 0 ? 20_000_000n : nodeId === 1 ? 30_000_000n : 0n,
      expiry: now + 86_400,
      dependencyMask: nodeId === 0 ? 0 : 1 << (nodeId - 1),
      specificationHash: keccak256(stringToHex(`failure-node-${nodeId}`)),
      compensationSpecificationHash: nodeId < 2 ? keccak256(stringToHex(`compensation-node-${nodeId}`)) : `0x${"00".repeat(32)}` as Hash,
      compensationType: nodeId < 2 ? 1 : 0,
      humanApprovalRequired: false,
      metadataURI: `urn:agentsaga:failure:${nodeId}`,
    }));
    const createHash = await wallet.writeContract({ address: factory, abi: workflowFactoryAbi, functionName: "createWorkflow", args: [usdc, 500_000_000n, 50_000_000n, now + 172_800, keccak256(stringToHex("failure-dag")), "urn:agentsaga:failure", keccak256(stringToHex("failure-salt")), nodes] });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    const failureWorkflow = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "workflowById", args: [1n] });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "mint", args: [account, 550_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "approve", args: [failureWorkflow, 550_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "fund" }) });
    await prisma.workflow.create({ data: { address: failureWorkflow.toLowerCase(), chainId: arcTestnet.id, owner: account.toLowerCase(), paymentToken: usdc.toLowerCase(), status: "Active", statusCode: 2, statusLabel: "Active", totalBudget: "550000000", nodeCount: 5, createdBlock: createReceipt.blockNumber, state: {} } });

    const signerFor = (address: Address): TransactionSigner => {
      const scopedWallet = createWalletClient({ account: address, chain: arcTestnet, transport: http(rpcUrl) });
      return {
        address: async () => address,
        status: async () => "ready",
        sendContractTransaction: async (request: ContractWriteRequest): Promise<Hash> => scopedWallet.sendTransaction({ account: address, chain: arcTestnet, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) }),
      };
    };
    for (const role of ["workflow-owner", "operator", "provider", "evaluator", "permissionless-executor"] as const) await signers.register({ workflow: failureWorkflow, role }, signer);
    for (const nodeId of [0, 1]) {
      await signers.register({ workflow: failureWorkflow, nodeId, role: "compensation-provider" }, signerFor(compensationProvider));
      await signers.register({ workflow: failureWorkflow, nodeId, role: "compensation-evaluator" }, signerFor(compensationEvaluator));
    }
    await queues.enqueue("discover-ready-nodes", `${failureWorkflow}:discover`, { workflow: failureWorkflow });
    await expect.poll(async () => publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "finalized" }), { timeout: 60_000, interval: 500 }).toBe(true);
    await expect.poll(async () => prisma.evidenceRecord.count({ where: { workflowAddress: failureWorkflow.toLowerCase(), kind: "workflow-receipt" } }), { timeout: 15_000 }).toBe(1);
    const [failedMask, skippedMask, pendingMask, compensatedMask, refunded] = await Promise.all([
      publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "failedMask" }),
      publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "skippedMask" }),
      publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "compensationPendingMask" }),
      publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "compensatedMask" }),
      publicClient.readContract({ address: failureWorkflow, abi: workflowCoordinatorAbi, functionName: "refunded" }),
    ]);
    expect({ failedMask, skippedMask, pendingMask, compensatedMask, refunded }).toEqual({ failedMask: 4, skippedMask: 24, pendingMask: 0, compensatedMask: 3, refunded: 300_000_000n });
    const jobs = await prisma.workflowJob.findMany({ where: { workflowAddress: failureWorkflow.toLowerCase() } });
    expect(jobs.filter((job) => job.jobType === "compensation")).toHaveLength(2);
    expect(jobs.filter((job) => job.jobType === "compensation").every((job) => job.provider === compensationProvider.toLowerCase() && job.evaluator === compensationEvaluator.toLowerCase())).toBe(true);
    const executions = await prisma.agentExecution.findMany({ where: { workflowAddress: failureWorkflow.toLowerCase(), nodeId: { in: [0, 1] } } });
    for (const nodeId of [0, 1]) expect(executions.filter((execution) => execution.nodeId === nodeId).map((execution) => execution.executionType).sort()).toEqual(["compensation", "service"]);
    const transactions = await prisma.chainTransaction.findMany({ where: { workflowAddress: failureWorkflow.toLowerCase(), action: { in: ["activate-node", "submit-deliverable", "complete-job", "reject-job", "open-compensation"] } } });
    expect(new Set(transactions.map((transaction) => transaction.hash)).size).toBe(transactions.length);
    expect(await prisma.deadLetterRecord.count({ where: { payload: { path: ["workflow"], equals: failureWorkflow.toLowerCase() } } })).toBe(0);
  }, 90_000);

  it("recovers a persisted transaction hash after worker restart without resending", async () => {
    const now = Number((await publicClient.getBlock()).timestamp);
    const nodes = [{ provider: account, evaluator: account, budget: 10_000_000n, compensationBudget: 0n, expiry: now + 86_400, dependencyMask: 0, specificationHash: keccak256(stringToHex("restart-node")), compensationSpecificationHash: `0x${"00".repeat(32)}`, compensationType: 0, humanApprovalRequired: false, metadataURI: "urn:agentsaga:restart" }];
    const createHash = await wallet.writeContract({ address: factory, abi: workflowFactoryAbi, functionName: "createWorkflow", args: [usdc, 10_000_000n, 0n, now + 172_800, keccak256(stringToHex("restart-dag")), "urn:agentsaga:restart", keccak256(stringToHex("restart-salt")), nodes] });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    const restartWorkflow = await publicClient.readContract({ address: factory, abi: workflowFactoryAbi, functionName: "workflowById", args: [2n] });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "mint", args: [account, 10_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: usdc, abi: mockAbi, functionName: "approve", args: [restartWorkflow, 10_000_000n] }) });
    await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: restartWorkflow, abi: workflowCoordinatorAbi, functionName: "fund" }) });
    await prisma.workflow.create({ data: { address: restartWorkflow.toLowerCase(), chainId: arcTestnet.id, owner: account.toLowerCase(), paymentToken: usdc.toLowerCase(), status: "Active", statusCode: 2, statusLabel: "Active", totalBudget: "10000000", nodeCount: 1, createdBlock: createReceipt.blockNumber, state: {} } });

    const restartRedis = `${process.env.REDIS_URL}/2`;
    let beforeRestart = true;
    let sendCount = 0;
    const restartSigner: TransactionSigner = {
      address: async () => account,
      status: async () => "ready",
      sendContractTransaction: async (request: ContractWriteRequest): Promise<Hash> => {
        sendCount++;
        return wallet.sendTransaction({ account, chain: arcTestnet, to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) });
      },
    };
    const flakyClient = new Proxy(publicClient, {
      get(target, property) {
        if (property === "getTransaction") return async (...args: Parameters<typeof target.getTransaction>) => {
          if (beforeRestart) throw new Error("temporary transaction lookup outage");
          return target.getTransaction(...args);
        };
        if (property === "waitForTransactionReceipt") return async (...args: Parameters<typeof target.waitForTransactionReceipt>) => {
          if (beforeRestart) throw new Error("temporary receipt outage after RPC acceptance");
          return target.waitForTransactionReceipt(...args);
        };
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as typeof publicClient;
    const capabilities = defaultCapabilities("autonomous"); for (const key of Object.keys(capabilities) as Array<keyof typeof capabilities>) capabilities[key] = "ready";
    const firstSigners = new SignerRegistry();
    for (const role of ["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "compensation-evaluator", "permissionless-executor"] as const) await firstSigners.register({ workflow: restartWorkflow, role }, restartSigner);
    const firstQueues = new QueueRuntime(restartRedis);
    await firstQueues.connection.flushdb();
    const firstRuntime = new WorkerRuntime(firstQueues, loadConfig({ NODE_ENV: "test", ARC_TESTNET_RPC_URL: rpcUrl, DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: restartRedis, OPERATION_MODE: "autonomous", RECEIPT_REGISTRY_ADDRESS: receiptRegistry }), firstSigners, capabilities, flakyClient);
    firstRuntime.registerAll();
    await firstQueues.waitUntilReady();
    await firstQueues.enqueue("discover-ready-nodes", `${restartWorkflow}:discover`, { workflow: restartWorkflow });
    await expect.poll(async () => prisma.workerAction.findFirst({ where: { workflow: restartWorkflow.toLowerCase(), action: "activate-node" } }).then((action) => ({ hash: action?.transactionHash, status: action?.status })), { timeout: 15_000 }).toMatchObject({ hash: expect.stringMatching(/^0x/), status: "failed" });
    await firstQueues.close();
    beforeRestart = false;

    const recoveredSigners = new SignerRegistry();
    for (const role of ["workflow-owner", "operator", "provider", "evaluator", "compensation-provider", "compensation-evaluator", "permissionless-executor"] as const) await recoveredSigners.register({ workflow: restartWorkflow, role }, restartSigner);
    const recoveredQueues = new QueueRuntime(restartRedis);
    const recoveredRuntime = new WorkerRuntime(recoveredQueues, loadConfig({ NODE_ENV: "test", ARC_TESTNET_RPC_URL: rpcUrl, DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: restartRedis, OPERATION_MODE: "autonomous", RECEIPT_REGISTRY_ADDRESS: receiptRegistry }), recoveredSigners, capabilities, flakyClient);
    recoveredRuntime.registerAll();
    await recoveredQueues.waitUntilReady();
    try {
      await expect.poll(async () => prisma.workerAction.findFirst({ where: { workflow: restartWorkflow.toLowerCase(), action: "activate-node" } }).then((action) => action?.status), { timeout: 20_000 }).toBe("completed");
      expect(sendCount).toBe(1);
      const activation = await prisma.workerAction.findFirstOrThrow({ where: { workflow: restartWorkflow.toLowerCase(), action: "activate-node" } });
      expect(activation.transactionNonce).not.toBeNull();
      expect(await prisma.chainTransaction.count({ where: { logicalActionKey: activation.idempotencyKey } })).toBe(1);
    } finally {
      await recoveredQueues.close();
    }
  }, 60_000);

  it("retries failed PostgreSQL event projections after restart-safe raw ingestion", async () => {
    const sourceId = `integration:projection-retry:${process.pid}:${Date.now()}`;
    const store = new PostgresCursorStore(arcTestnet.id, prisma);
    const projectionTransactionHash = keccak256(stringToHex(sourceId));
    const projectionBlockHash = keccak256(stringToHex(`${sourceId}:block`));
    const log = {
      address: workflow,
      topics: [],
      data: "0x",
      transactionHash: projectionTransactionHash,
      transactionIndex: 0,
      blockHash: projectionBlockHash,
      blockNumber: 999n,
      logIndex: 0,
      removed: false,
    } as Log;
    expect(await store.putLogIfAbsent(sourceId, log)).toBe(true);
    expect(await store.putLogIfAbsent(sourceId, log)).toBe(false);
    await store.save(sourceId, { nextBlock: 1_000n, lastProcessedBlock: 999n, lastProcessedHash: log.blockHash! });
    expect((await store.load(sourceId))?.nextBlock).toBe(1_000n);
    let fail = true;
    const projection = async () => {
      if (fail) throw new Error("temporary WorkflowCreated projection RPC failure");
    };
    expect(await projectPendingEvents(store, sourceId, projection)).toBe(0);
    const failed = await prisma.indexedEvent.findFirstOrThrow({ where: { sourceId } });
    expect(failed).toMatchObject({ projectionStatus: "failed", projectionAttempts: 1 });
    expect(failed.lastProjectionError).toMatch(/temporary WorkflowCreated/);
    await prisma.indexedEvent.update({ where: { id: failed.id }, data: { nextProjectionAttemptAt: new Date(0) } });
    fail = false;
    expect(await projectPendingEvents(store, sourceId, projection)).toBe(1);
    expect(await prisma.indexedEvent.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ projectionStatus: "processed", lastProjectionError: null });
  });
});
