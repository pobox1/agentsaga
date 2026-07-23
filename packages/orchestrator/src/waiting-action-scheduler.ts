import { randomUUID } from "node:crypto";
import type { PrismaClient, WorkerAction } from "@prisma/client";
import type { QueueName, QueueRuntime } from "./queues.js";
import { PostgresQueueOutbox, stagedActionFromRecord } from "./queue-outbox.js";

export type ActionRequirementCheck = (action: WorkerAction) => Promise<boolean>;
type QueueOutboxPort = Pick<PostgresQueueOutbox, "stage" | "dispatchPending">;

export class WaitingActionScheduler {
  private readonly outbox: QueueOutboxPort;
  constructor(
    private readonly db: PrismaClient,
    private readonly queues: QueueRuntime,
    private readonly stillRequired: ActionRequirementCheck = async () => true,
    private readonly leaseSeconds = 30,
    outbox?: QueueOutboxPort,
  ) { this.outbox = outbox ?? new PostgresQueueOutbox(db, queues); }

  async runOnce(limit = 50): Promise<number> {
    const owner = `${process.pid}:${randomUUID()}`;
    const claimed = await this.db.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ locked: number }>>`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('agentsaga-waiting-action-scheduler'))) AS scheduler_lock`;
      return transaction.$queryRaw<WorkerAction[]>`
      UPDATE "WorkerAction" AS action
      SET "leaseOwner" = ${owner}, "leaseExpiresAt" = NOW() + (${this.leaseSeconds} * INTERVAL '1 second')
      WHERE (action."leaseExpiresAt" IS NULL OR action."leaseExpiresAt" < NOW())
        AND action."id" IN (
        SELECT candidate."id" FROM "WorkerAction" AS candidate
        WHERE candidate."status" = 'waiting'
          AND candidate."nextAttemptAt" <= NOW()
          AND (candidate."leaseExpiresAt" IS NULL OR candidate."leaseExpiresAt" < NOW())
        ORDER BY candidate."nextAttemptAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING action.*
      `;
    });
    let scheduled = 0;
    for (const action of claimed) {
      if (!(await this.stillRequired(action))) {
        await this.db.workerAction.update({ where: { id: action.id }, data: { status: "completed", completedAt: new Date(), lastResult: { status: "already_complete", detail: "Fresh onchain state shows the action is no longer required" }, leaseOwner: null, leaseExpiresAt: null } });
        continue;
      }
      const resumeSequence = action.resumeSequence + 1;
      await this.outbox.stage(stagedActionFromRecord(action, resumeSequence));
      await this.db.workerAction.update({ where: { id: action.id }, data: { resumeAttempts: { increment: 1 } } });
      scheduled++;
    }
    await this.outbox.dispatchPending(limit);
    return scheduled;
  }

  async resumeForEvent(input: { workflow: string; nodeId?: number; reasons?: string[] }): Promise<number> {
    const due = await this.db.workerAction.updateMany({
      where: { workflow: input.workflow.toLowerCase(), status: "waiting", ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }), ...(input.reasons ? { waitingReason: { in: input.reasons } } : {}) },
      data: { nextAttemptAt: new Date() },
    });
    return due.count;
  }
}
