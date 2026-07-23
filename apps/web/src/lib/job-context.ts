import type { Address } from "viem";

export type EffectiveJobContext = {
  jobId: bigint;
  jobType: "service" | "compensation";
  provider: Address;
  evaluator: Address;
  budget: bigint;
  expiry: bigint;
  status: number;
};

export function effectiveJobContext(
  node: {
    status: number;
    jobId: bigint;
    provider: Address;
    evaluator: Address;
    budget: bigint;
    expiry: bigint | number;
  },
  activeJob?: {
    provider: Address;
    evaluator: Address;
    budget: bigint;
    expiredAt: bigint | number;
    status: number;
  },
): EffectiveJobContext {
  const compensation = Number(node.status) === 9;
  if (compensation && !activeJob) throw new Error("The active remediation job could not be loaded");
  return compensation
    ? {
      jobId: node.jobId,
      jobType: "compensation",
      provider: activeJob!.provider,
      evaluator: activeJob!.evaluator,
      budget: activeJob!.budget,
      expiry: BigInt(activeJob!.expiredAt),
      status: Number(activeJob!.status),
    }
    : {
      jobId: node.jobId,
      jobType: "service",
      provider: node.provider,
      evaluator: node.evaluator,
      budget: node.budget,
      expiry: BigInt(node.expiry),
      status: Number(node.status) === 4 ? 2 : Number(node.status) === 2 ? 1 : Number(node.status),
    };
}

export function assertJobRole(
  context: EffectiveJobContext,
  action: "submit" | "evaluate",
  account: Address,
): void {
  const expected = action === "submit" ? context.provider : context.evaluator;
  if (expected.toLowerCase() !== account.toLowerCase()) {
    throw new Error(`The active wallet is not the ${context.jobType} job ${action === "submit" ? "provider" : "evaluator"}`);
  }
  const expectedStatus = action === "submit" ? 1 : 2;
  if (context.status !== expectedStatus) {
    throw new Error(`The ${context.jobType} job is not ${action === "submit" ? "funded" : "submitted"}`);
  }
}
