import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, WorkerAction } from "@prisma/client";
import type { QueueRuntime } from "./queues.js";
import { WaitingActionScheduler } from "./waiting-action-scheduler.js";

const action = { id: "action-1", workflow: "0x1111111111111111111111111111111111111111", nodeId: 0, action: "activate-node", idempotencyKey: "workflow:0:activate-node", status: "waiting", attempts: 0, executionAttempts: 0, resumeAttempts: 0, resumeSequence: 0, nextAttemptAt: new Date(), waitingReason: "role_signer", lastResult: null, transactionHash: null, transactionNonce: null, signerRole: null, startedAt: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null, payload: { workflow: "0x1111111111111111111111111111111111111111", nodeId: 0 }, createdAt: new Date(), updatedAt: new Date() } as WorkerAction;

function fixtures(claim: () => WorkerAction[]) {
  const update = vi.fn(async () => action); const enqueue = vi.fn(async () => ({}));
  const db = { $transaction: vi.fn(async (callback: (tx: { $queryRaw: ReturnType<typeof vi.fn> }) => unknown) => { let calls = 0; const transaction = { $queryRaw: vi.fn(async () => ++calls === 1 ? [{ pg_advisory_xact_lock: null }] : claim()) }; return callback(transaction); }), workerAction: { update } } as unknown as PrismaClient;
  const queues = { enqueue } as unknown as QueueRuntime;
  const stage = vi.fn(async () => "outbox-1");
  const dispatchPending = vi.fn(async () => 1);
  const outbox = { stage, dispatchPending };
  return { db, queues, update, enqueue, stage, dispatchPending, outbox };
}

describe("durable waiting scheduler", () => {
  it("re-enqueues with a unique resume sequence and stable logical key", async () => {
    const fixture = fixtures(() => [action]);
    expect(await new WaitingActionScheduler(fixture.db, fixture.queues, undefined, 30, fixture.outbox).runOnce()).toBe(1);
    expect(fixture.stage).toHaveBeenCalledWith(expect.objectContaining({ queue: "activate-node", idempotencyKey: action.idempotencyKey, resumeSequence: 1, executionAttempt: 0 }));
    expect(fixture.dispatchPending).toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resumeAttempts: { increment: 1 } }) }));
  });
  it("does not duplicate a row claimed by two scheduler processes", async () => {
    let available = true; const fixture = fixtures(() => { if (!available) return []; available = false; return [action]; });
    const results = await Promise.all([new WaitingActionScheduler(fixture.db, fixture.queues, undefined, 30, fixture.outbox).runOnce(), new WaitingActionScheduler(fixture.db, fixture.queues, undefined, 30, fixture.outbox).runOnce()]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1); expect(fixture.stage).toHaveBeenCalledTimes(1);
  });
  it("marks a no-longer-required onchain action complete without sending it", async () => {
    const fixture = fixtures(() => [action]);
    expect(await new WaitingActionScheduler(fixture.db, fixture.queues, async () => false, 30, fixture.outbox).runOnce()).toBe(0);
    expect(fixture.stage).not.toHaveBeenCalled(); expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });
});
