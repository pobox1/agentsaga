import { describe, expect, it, vi } from "vitest";
import { queueNames, missingRequiredProcessors, type QueueName, type QueueRuntime } from "./queues.js";
import { WorkerRuntime, outcomePersistence, type ProcessorOutcome } from "./worker-runtime.js";
import { loadConfig } from "./config.js";

describe("production worker registration", () => {
  it("registers a processor for every required BullMQ queue", () => {
    const registered: QueueName[] = [];
    const queues = { setProcessorFactProvider: vi.fn(), register: vi.fn((name: QueueName) => { registered.push(name); }) } as unknown as QueueRuntime;
    new WorkerRuntime(queues, loadConfig({ NODE_ENV: "test" })).registerAll();
    expect(registered).toEqual(queueNames);
    expect(missingRequiredProcessors(registered)).toEqual([]);
  });
  it("reports readiness gaps when any processor is missing", () => {
    expect(missingRequiredProcessors(queueNames.slice(1))).toEqual(["index-events"]);
  });
  it("reports missing agent adapters from the actual runtime registry", async () => {
    const queues = { setProcessorFactProvider: vi.fn(), register: vi.fn() } as unknown as QueueRuntime;
    const runtime = new WorkerRuntime(
      queues,
      loadConfig({ NODE_ENV: "test", OPERATION_MODE: "autonomous" }),
      undefined,
      undefined,
      undefined,
      [],
    );
    const facts = await runtime.factualProcessorCapabilities();
    expect(facts["execute-agent"]).toMatchObject({ adapterAvailability: "missing", operational: false });
    expect(facts["execute-compensation"]).toMatchObject({ adapterAvailability: "missing", operational: false });
  });
  it("persists a missing signer as durable waiting without consuming an execution attempt", () => {
    const outcome: ProcessorOutcome = { status: "waiting", reason: "role_signer", retryable: true, detail: "provider signer is unavailable" };
    expect(outcomePersistence(outcome as Extract<ProcessorOutcome, { status: "waiting" }>, new Date("2026-07-22T00:00:00.000Z"), 30)).toMatchObject({ status: "waiting", waitingReason: "role_signer", nextAttemptAt: new Date("2026-07-22T00:00:30.000Z") });
  });
  it("keeps human approval waiting event-driven instead of scheduling failure retries", () => {
    const outcome = { status: "waiting", reason: "human_approval", retryable: false, detail: "NodeApproved required" } as const;
    expect(outcomePersistence(outcome, new Date(), 30).nextAttemptAt).toBeNull();
  });
});
