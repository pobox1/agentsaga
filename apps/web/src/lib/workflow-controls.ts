import type { Hex } from "viem";

export function coordinatorImmutableUint(bytecode: Hex | undefined, slot: number): bigint | undefined {
  if (!bytecode || slot < 0) return undefined;
  const start = 2 + (0x2d + slot * 0x20) * 2;
  const encoded = bytecode.slice(start, start + 64);
  return encoded.length === 64 ? BigInt(`0x${encoded}`) : undefined;
}

export function canCancelWorkflow(input: { isOwner: boolean; activationMask: number; reservedForJobs: bigint; finalized: boolean; status: number }): boolean {
  return input.isOwner && input.activationMask === 0 && input.reservedForJobs === 0n && !input.finalized && [0, 1, 2].includes(input.status);
}

export function canExpireWorkflow(input: { now: number; globalDeadline?: bigint; finalized: boolean; status: number; compensationPendingMask: number }): boolean {
  return input.globalDeadline !== undefined && BigInt(input.now) >= input.globalDeadline && !input.finalized && input.status !== 4 && input.compensationPendingMask === 0;
}
