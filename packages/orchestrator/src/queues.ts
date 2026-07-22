import { createHash } from "node:crypto";
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis from "ioredis";

export const queueNames = ["index-events", "discover-ready-nodes", "activate-node", "execute-agent", "submit-deliverable", "evaluate-job", "complete-job", "reject-job", "open-compensation", "execute-compensation", "expire-job", "expire-compensation", "expire-workflow", "build-receipt-index", "reconcile-state"] as const;
export type QueueName = typeof queueNames[number];
const defaultJobOptions: JobsOptions = { attempts: 7, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: false };

export class QueueRuntime {
  readonly connection: IORedis;
  readonly queues: Record<QueueName, Queue>;
  readonly deadLetter: Queue;
  private readonly workers: Worker[] = [];
  private readonly registered = new Set<QueueName>();
  private heartbeat?: NodeJS.Timeout;
  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    this.queues = Object.fromEntries(queueNames.map((name) => [name, new Queue(name, { connection: this.connection, defaultJobOptions })])) as Record<QueueName, Queue>;
    this.deadLetter = new Queue("dead-letter", { connection: this.connection });
  }
  register<T>(name: QueueName, processor: Processor<T>) {
    const worker = new Worker<T>(name, processor, { connection: this.connection, concurrency: 4, lockDuration: 60_000 });
    worker.on("failed", (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void this.deadLetter.add(name, { originalJobId: job.id, payload: job.data, error: error.message }, { jobId: `${name}:${job.id}`, removeOnComplete: false });
    });
    this.registered.add(name);
    void this.publishProcessorHeartbeat();
    this.heartbeat ??= setInterval(() => void this.publishProcessorHeartbeat(), 15_000);
    this.workers.push(worker); return worker;
  }
  async enqueue(name: QueueName, idempotencyKey: string, payload: unknown) {
    if (!idempotencyKey.trim()) throw new Error("A deterministic idempotency key is required");
    return this.queues[name].add(name, payload, { jobId: queueJobId(name, idempotencyKey) });
  }
  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...Object.values(this.queues), this.deadLetter].map((queue) => queue.close()));
    await this.connection.quit();
  }
  registeredProcessors(): QueueName[] { return [...this.registered]; }
  async processorReadiness(): Promise<Record<QueueName, boolean>> {
    const values = await Promise.all(queueNames.map((name) => this.connection.exists(`agentsaga:processor:${name}`)));
    return Object.fromEntries(queueNames.map((name, index) => [name, values[index] === 1])) as Record<QueueName, boolean>;
  }
  private async publishProcessorHeartbeat(): Promise<void> {
    await Promise.all([...this.registered].map((name) => this.connection.set(`agentsaga:processor:${name}`, String(process.pid), "EX", 45)));
  }
}

export function queueJobId(name: QueueName, idempotencyKey: string): string {
  return createHash("sha256").update(`${name}\0${idempotencyKey}`).digest("hex");
}
export function missingRequiredProcessors(registered: Iterable<QueueName>): QueueName[] {
  const available = new Set(registered);
  return queueNames.filter((name) => !available.has(name));
}
