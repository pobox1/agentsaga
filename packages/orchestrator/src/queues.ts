import { createHash } from "node:crypto";
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import type { CapabilityStatus, OperationMode, RuntimeCapabilityConfiguration } from "./capabilities.js";

export const queueNames = ["index-events", "discover-ready-nodes", "activate-node", "execute-agent", "submit-deliverable", "evaluate-job", "complete-job", "reject-job", "open-compensation", "execute-compensation", "expire-job", "expire-compensation", "expire-workflow", "build-receipt-index", "reconcile-state"] as const;
export type QueueName = typeof queueNames[number];
const defaultJobOptions: JobsOptions = { attempts: 7, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: false };
export type ProcessorRuntimeFact = {
  registered: boolean;
  configuredCapability: CapabilityStatus;
  dependencyStatus: "ready" | "missing" | "waiting_auth" | "manual" | "unhealthy";
  signerAvailability?: "ready" | "missing" | "waiting_auth" | "manual" | "disabled";
  signerRole?: string;
  adapterAvailability?: "ready" | "missing" | "manual" | "disabled" | "unhealthy";
  operational: boolean;
  detail?: string;
};
export type RuntimeIdentity = Pick<RuntimeCapabilityConfiguration, "version" | "hash" | "mode"> & { gitCommit: string };
export type ProcessorHeartbeatDetail = ProcessorRuntimeFact & {
  fresh: boolean;
  timestamp?: string;
  processId?: number;
  gitCommit?: string;
  mode?: OperationMode;
  configVersion?: string;
  configHash?: string;
};

export class QueueRuntime {
  readonly connection: IORedis;
  readonly queues: Record<QueueName, Queue>;
  readonly deadLetter: Queue;
  private readonly workers: Worker[] = [];
  private readonly registered = new Set<QueueName>();
  private readonly capabilities = new Map<QueueName, CapabilityStatus>();
  private factProvider?: () => Promise<Record<QueueName, ProcessorRuntimeFact>>;
  private heartbeat?: NodeJS.Timeout;
  constructor(redisUrl: string, private readonly identity?: RuntimeIdentity) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    this.queues = Object.fromEntries(queueNames.map((name) => [name, new Queue(name, { connection: this.connection, defaultJobOptions })])) as Record<QueueName, Queue>;
    this.deadLetter = new Queue("dead-letter", { connection: this.connection });
  }
  register<T>(name: QueueName, processor: Processor<T>, capability: CapabilityStatus = "not_configured") {
    const worker = new Worker<T>(name, processor, { connection: this.connection, concurrency: 4, lockDuration: 60_000 });
    worker.on("failed", (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void this.deadLetter.add(name, { originalJobId: job.id, payload: job.data, error: error.message }, { jobId: `${name}:${job.id}`, removeOnComplete: false });
    });
    this.registered.add(name);
    this.capabilities.set(name, capability);
    void this.publishProcessorHeartbeat();
    this.heartbeat ??= setInterval(() => void this.publishProcessorHeartbeat(), 15_000);
    this.workers.push(worker); return worker;
  }
  async enqueue(name: QueueName, idempotencyKey: string, payload: unknown, attempt: { actionId?: string; resumeSequence?: number; executionAttempt?: number } = {}) {
    if (!idempotencyKey.trim()) throw new Error("A deterministic idempotency key is required");
    const jobId = attempt.actionId
      ? executionJobId(attempt.actionId, attempt.resumeSequence ?? 0, attempt.executionAttempt ?? 0)
      : queueJobId(name, idempotencyKey);
    return this.queues[name].add(name, { ...(typeof payload === "object" && payload !== null ? payload : { value: payload }), logicalActionKey: idempotencyKey, ...attempt }, { jobId });
  }
  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...Object.values(this.queues), this.deadLetter].map((queue) => queue.close()));
    await this.connection.quit();
  }
  setProcessorFactProvider(provider: () => Promise<Record<QueueName, ProcessorRuntimeFact>>): void {
    this.factProvider = provider;
  }
  registeredProcessors(): QueueName[] { return [...this.registered]; }
  async waitUntilReady(): Promise<void> { await Promise.all(this.workers.map((worker) => worker.waitUntilReady())); }
  async pauseWorkers(): Promise<void> { await Promise.all(this.workers.map((worker) => worker.pause(true))); }
  async processorReadiness(staleSeconds = 45): Promise<Record<QueueName, boolean>> {
    const details = await this.processorHeartbeatDetails(staleSeconds);
    return Object.fromEntries(queueNames.map((name) => [name, details[name]?.fresh === true])) as Record<QueueName, boolean>;
  }
  async processorHeartbeatDetails(staleSeconds = 45): Promise<Record<QueueName, ProcessorHeartbeatDetail>> {
    const values = await Promise.all(queueNames.map((name) => this.connection.get(`agentsaga:processor:${name}`)));
    const now = Date.now();
    return Object.fromEntries(queueNames.map((name, index) => {
      try {
        const value = JSON.parse(values[index] ?? "null") as Omit<ProcessorHeartbeatDetail, "fresh"> | null;
        const fresh = Boolean(value?.timestamp && now - Date.parse(value.timestamp) <= staleSeconds * 1_000);
        return [name, { ...(value ?? {}), fresh }];
      } catch { return [name, { fresh: false }]; }
    })) as Record<QueueName, ProcessorHeartbeatDetail>;
  }
  async publishProcessorHeartbeat(): Promise<void> {
    const timestamp = new Date().toISOString();
    const facts = await this.factProvider?.();
    await Promise.all([...this.registered].map((name) => {
      const configuredCapability = this.capabilities.get(name) ?? "not_configured";
      const fact = facts?.[name] ?? {
        registered: true,
        configuredCapability,
        dependencyStatus: "missing" as const,
        operational: false,
        detail: "No factual capability provider is attached",
      };
      return this.connection.set(`agentsaga:processor:${name}`, JSON.stringify({
        processId: process.pid,
        gitCommit: this.identity?.gitCommit ?? process.env.GIT_COMMIT_SHA ?? "unknown",
        timestamp,
        mode: this.identity?.mode ?? process.env.OPERATION_MODE ?? "manual",
        configVersion: this.identity?.version,
        configHash: this.identity?.hash,
        ...fact,
      }), "EX", 90);
    }));
  }
}

export function queueJobId(name: QueueName, idempotencyKey: string): string {
  return createHash("sha256").update(`${name}\0${idempotencyKey}`).digest("hex");
}
export function executionJobId(actionId: string, resumeSequence: number, executionAttempt: number): string {
  return createHash("sha256").update(`${actionId}:${resumeSequence}:${executionAttempt}`).digest("hex");
}
export function missingRequiredProcessors(registered: Iterable<QueueName>): QueueName[] {
  const available = new Set(registered);
  return queueNames.filter((name) => !available.has(name));
}
