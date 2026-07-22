import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, WorkerAction } from "@prisma/client";
import type { QueueRuntime } from "./queues.js";
import { WaitingActionScheduler } from "./waiting-action-scheduler.js";

const action = { id: "action-1", workflow: "0x1111111111111111111111111111111111111111", nodeId: 0, action: "activate-node", idempotencyKey: "workflow:0:activate-node", status: "waiting", attempts: 0, executionAttempts: 0, resumeAttempts: 0, resumeSequence: 0, nextAttemptAt: new Date(), waitingReason: "role_signer", lastResult: null, transactionHash: null, transactionNonce: null, signerRole: null, startedAt: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null, payload: { workflow: "0x1111111111111111111111111111111111111111", nodeId: 0 }, createdAt: new Date(), updatedAt: new Date() } as WorkerAction;

function fixtures(claim: () => WorkerAction[]) {
  const update = vi.fn(async () => action); const enqueue = vi.fn(async () => ({}));
  const db = { $transaction: vi.fn(async (callback: (tx: { $queryRaw: ReturnType<typeof vi.fn> }) => unknown) => { let calls = 0; const transaction = { $queryRaw: vi.fn(async () => ++calls === 1 ? [{ pg_advisory_xact_lock: null }] : claim()) }; return callback(transaction); }), workerAction: { update } } as unknown as PrismaClient;
  const queues = { enqueue } as unknown as QueueRuntime;
  return { db, queues, update, enqueue };
}

describe("durable waiting scheduler", () => {
  it("re-enqueues with a unique resume sequence and stable logical key", async () => {
    const fixture = fixtures(() => [action]);
    expect(await new WaitingActionScheduler(fixture.db, fixture.queues).runOnce()).toBe(1);
    expect(fixture.enqueue).toHaveBeenCalledWith("activate-node", action.idempotencyKey, action.payload, { actionId: action.id, resumeSequence: 1, executionAttempt: 0 });
    expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "queued", resumeSequence: 1 }) }));
  });
  it("does not duplicate a row claimed by two scheduler processes", async () => {
    let available = true; const fixture = fixtures(() => { if (!available) return []; available = false; return [action]; });
    const results = await Promise.all([new WaitingActionScheduler(fixture.db, fixture.queues).runOnce(), new WaitingActionScheduler(fixture.db, fixture.queues).runOnce()]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1); expect(fixture.enqueue).toHaveBeenCalledTimes(1);
  });
  it("marks a no-longer-required onchain action complete without sending it", async () => {
    const fixture = fixtures(() => [action]);
    expect(await new WaitingActionScheduler(fixture.db, fixture.queues, async () => false).runOnce()).toBe(0);
    expect(fixture.enqueue).not.toHaveBeenCalled(); expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });
});
