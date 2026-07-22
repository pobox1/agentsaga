import { describe, expect, it, vi } from "vitest";
import { queueNames, missingRequiredProcessors, type QueueName, type QueueRuntime } from "./queues.js";
import { WorkerRuntime } from "./worker-runtime.js";
import { loadConfig } from "./config.js";

describe("production worker registration", () => {
  it("registers a processor for every required BullMQ queue", () => {
    const registered: QueueName[] = [];
    const queues = { register: vi.fn((name: QueueName) => { registered.push(name); }) } as unknown as QueueRuntime;
    new WorkerRuntime(queues, loadConfig({ NODE_ENV: "test" })).registerAll();
    expect(registered).toEqual(queueNames);
    expect(missingRequiredProcessors(registered)).toEqual([]);
  });
  it("reports readiness gaps when any processor is missing", () => {
    expect(missingRequiredProcessors(queueNames.slice(1))).toEqual(["index-events"]);
  });
});
