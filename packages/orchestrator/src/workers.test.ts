import { describe, expect, it, vi } from "vitest";
import { IdempotentWorker, InMemoryActionLedger } from "./workers.js";

describe("IdempotentWorker", () => {
  it("executes a payout-like action once for one idempotency key", async () => {
    const execute = vi.fn(async () => undefined);
    const worker = new IdempotentWorker(new InMemoryActionLedger(), execute);
    const action = {
      idempotencyKey: "0xworkflow:node-2:activate",
      type: "activate-node" as const,
      workflow: "0xworkflow",
      nodeId: 2,
      payload: {},
    };
    await expect(worker.execute(action)).resolves.toBe("executed");
    await expect(worker.execute(action)).resolves.toBe("duplicate");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

