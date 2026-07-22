import { describe, expect, it } from "vitest";
import { canCancelWorkflow, canExpireWorkflow, coordinatorImmutableUint } from "./workflow-controls";

describe("workflow lifecycle controls", () => {
  it("hides cancellation after activation, reservation, finalization, or terminal status", () => {
    expect(canCancelWorkflow({ isOwner: true, activationMask: 0, reservedForJobs: 0n, finalized: false, status: 1 })).toBe(true);
    expect(canCancelWorkflow({ isOwner: true, activationMask: 1, reservedForJobs: 0n, finalized: false, status: 1 })).toBe(false);
    expect(canCancelWorkflow({ isOwner: true, activationMask: 0, reservedForJobs: 1n, finalized: false, status: 1 })).toBe(false);
    expect(canCancelWorkflow({ isOwner: true, activationMask: 0, reservedForJobs: 0n, finalized: true, status: 5 })).toBe(false);
  });
  it("shows expiry only after the immutable global deadline and without compensation", () => {
    expect(canExpireWorkflow({ now: 101, globalDeadline: 100n, finalized: false, status: 2, compensationPendingMask: 0 })).toBe(true);
    expect(canExpireWorkflow({ now: 99, globalDeadline: 100n, finalized: false, status: 2, compensationPendingMask: 0 })).toBe(false);
    expect(canExpireWorkflow({ now: 101, globalDeadline: 100n, finalized: false, status: 4, compensationPendingMask: 1 })).toBe(false);
  });
  it("decodes the coordinator immutable deadline slot", () => {
    const prefix = "00".repeat(0x2d + 6 * 0x20); const value = "00".repeat(31) + "64";
    expect(coordinatorImmutableUint(`0x${prefix}${value}`, 6)).toBe(100n);
  });
});
