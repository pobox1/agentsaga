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
    this.workers.push(worker); return worker;
  }
  async enqueue(name: QueueName, idempotencyKey: string, payload: unknown) {
    if (!idempotencyKey.trim()) throw new Error("A deterministic idempotency key is required");
    return this.queues[name].add(name, payload, { jobId: queueJobId(name, idempotencyKey) });
  }
  async close() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...Object.values(this.queues), this.deadLetter].map((queue) => queue.close()));
    await this.connection.quit();
  }
}

export function queueJobId(name: QueueName, idempotencyKey: string): string {
  return createHash("sha256").update(`${name}\0${idempotencyKey}`).digest("hex");
}
