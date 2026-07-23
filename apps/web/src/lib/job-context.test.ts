import { describe, expect, it } from "vitest";
import { assertJobRole, effectiveJobContext } from "./job-context";

const originalProvider = "0x1111111111111111111111111111111111111111";
const originalEvaluator = "0x2222222222222222222222222222222222222222";
const remediationProvider = "0x3333333333333333333333333333333333333333";
const remediationEvaluator = "0x4444444444444444444444444444444444444444";

describe("effective compensation job roles", () => {
  it("uses fresh remediation provider, evaluator, budget and expiry", () => {
    const context = effectiveJobContext(
      { status: 9, jobId: 8n, provider: originalProvider, evaluator: originalEvaluator, budget: 10n, expiry: 100 },
      { provider: remediationProvider, evaluator: remediationEvaluator, budget: 25n, expiredAt: 200, status: 1 },
    );
    expect(context).toMatchObject({ jobType: "compensation", provider: remediationProvider, evaluator: remediationEvaluator, budget: 25n, expiry: 200n });
    expect(() => assertJobRole(context, "submit", remediationProvider)).not.toThrow();
    expect(() => assertJobRole(context, "submit", originalProvider)).toThrow(/compensation job provider/);
  });

  it("accepts only the remediation evaluator after submission", () => {
    const context = effectiveJobContext(
      { status: 9, jobId: 8n, provider: originalProvider, evaluator: originalEvaluator, budget: 10n, expiry: 100 },
      { provider: remediationProvider, evaluator: remediationEvaluator, budget: 25n, expiredAt: 200, status: 2 },
    );
    expect(() => assertJobRole(context, "evaluate", remediationEvaluator)).not.toThrow();
    expect(() => assertJobRole(context, "evaluate", originalEvaluator)).toThrow(/compensation job evaluator/);
  });
});
