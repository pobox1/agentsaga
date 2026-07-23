import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type WorkerAction } from "@prisma/client";
import type { QueueName, QueueRuntime } from "./queues.js";

export type StagedQueueAction = {
  id: string;
  workflow: string;
  nodeId?: number;
  queue: QueueName;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  resumeSequence?: number;
  executionAttempt?: number;
};

export class PostgresQueueOutbox {
  constructor(
    private readonly db: PrismaClient,
    private readonly queues: QueueRuntime,
    private readonly leaseSeconds = 30,
  ) {}

  async stage(input: StagedQueueAction): Promise<string> {
    const resumeSequence = input.resumeSequence ?? 0;
    const executionAttempt = input.executionAttempt ?? 0;
    const outboxId = outboxRecordId(input.id, resumeSequence, executionAttempt);
    await this.db.$transaction(async (transaction) => {
      await transaction.workerAction.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        create: {
          id: input.id,
          workflow: input.workflow.toLowerCase(),
          nodeId: input.nodeId ?? null,
          action: input.queue,
          idempotencyKey: input.idempotencyKey,
          status: "queued",
          resumeSequence,
          executionAttempts: executionAttempt,
          payload: input.payload,
        },
        update: {
          status: "queued",
          waitingReason: null,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          resumeSequence,
          payload: input.payload,
        },
      });
      await transaction.queueOutbox.upsert({
        where: { id: outboxId },
        create: {
          id: outboxId,
          queue: input.queue,
          idempotencyKey: input.idempotencyKey,
          actionId: input.id,
          resumeSequence,
          executionAttempt,
          payload: input.payload,
        },
        update: {},
      });
    });
    return outboxId;
  }

  async dispatchPending(limit = 100): Promise<number> {
    const owner = `${process.pid}:${randomUUID()}`;
    const now = new Date();
    const candidates = await this.db.queueOutbox.findMany({
      where: {
        OR: [
          { status: { in: ["pending", "failed"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
          { status: "publishing", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let published = 0;
    for (const candidate of candidates) {
      const claimed = await this.db.queueOutbox.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { status: { in: ["pending", "failed"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
            { status: "publishing", leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: "publishing",
          leaseOwner: owner,
          leaseExpiresAt: new Date(Date.now() + this.leaseSeconds * 1_000),
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.queues.enqueue(candidate.queue as QueueName, candidate.idempotencyKey, candidate.payload, {
          ...(candidate.actionId ? { actionId: candidate.actionId } : {}),
          resumeSequence: candidate.resumeSequence,
          executionAttempt: candidate.executionAttempt,
        });
        await this.db.queueOutbox.update({
          where: { id: candidate.id },
          data: { status: "published", publishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
        });
        published++;
      } catch (error) {
        await this.db.queueOutbox.update({
          where: { id: candidate.id },
          data: {
            status: "failed",
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
    }
    return published;
  }

  async reconcileOrphanedQueuedActions(limit = 100): Promise<number> {
    const actions = await this.db.workerAction.findMany({
      where: { status: "queued" },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    let repaired = 0;
    for (const action of actions) {
      const currentOutboxId = outboxRecordId(action.id, action.resumeSequence, action.executionAttempts);
      const currentOutbox = await this.db.queueOutbox.findUnique({ where: { id: currentOutboxId } });
      if (currentOutbox && currentOutbox.status !== "published") continue;
      const currentJob = await this.queues.queues[action.action as QueueName].getJob(
        executionJobId(action.id, action.resumeSequence, action.executionAttempts),
      );
      const state = currentJob ? await currentJob.getState() : "missing";
      if (!["missing", "completed", "failed", "unknown"].includes(state)) continue;
      const resumeSequence = currentOutbox?.status === "published" || state !== "missing"
        ? action.resumeSequence + 1
        : action.resumeSequence;
      await this.stage({
        id: action.id,
        workflow: action.workflow,
        ...(action.nodeId === null ? {} : { nodeId: action.nodeId }),
        queue: action.action as QueueName,
        idempotencyKey: action.idempotencyKey,
        payload: action.payload as Prisma.InputJsonValue,
        resumeSequence,
        executionAttempt: action.executionAttempts,
      });
      repaired++;
    }
    return repaired;
  }
}

export function outboxRecordId(actionId: string, resumeSequence: number, executionAttempt: number): string {
  return createHash("sha256").update(`${actionId}:${resumeSequence}:${executionAttempt}`).digest("hex");
}

function executionJobId(actionId: string, resumeSequence: number, executionAttempt: number): string {
  return createHash("sha256").update(`${actionId}:${resumeSequence}:${executionAttempt}`).digest("hex");
}

export function stagedActionFromRecord(action: WorkerAction, resumeSequence: number): StagedQueueAction {
  return {
    id: action.id,
    workflow: action.workflow,
    ...(action.nodeId === null ? {} : { nodeId: action.nodeId }),
    queue: action.action as QueueName,
    idempotencyKey: action.idempotencyKey,
    payload: action.payload as Prisma.InputJsonValue,
    resumeSequence,
    executionAttempt: action.executionAttempts,
  };
}
