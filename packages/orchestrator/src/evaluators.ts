import { z } from "zod";
import { hashJson } from "./hash.js";
import type {
  EvaluationInput,
  EvaluationResult,
  EvaluatorAdapter,
} from "./types.js";

export class DeterministicSchemaEvaluator implements EvaluatorAdapter {
  public readonly id = "deterministic-schema";

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const cost = BigInt(input.result.cost);
    const approved = input.result.success && cost >= 0n;
    return {
      decision: approved ? "approve" : "reject",
      reasonCode: approved ? "SCHEMA_VALID" : input.result.failureCode ?? "EXECUTION_FAILED",
      evidenceHash: hashJson({
        result: input.result.deliverableHash,
        approved,
        evaluator: this.id,
      }),
      evaluatorId: this.id,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export class HashMatchingEvaluator implements EvaluatorAdapter {
  public readonly id = "hash-matching";

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const approved =
      input.expectedHash !== undefined && input.expectedHash === input.result.deliverableHash;
    return {
      decision: approved ? "approve" : "reject",
      reasonCode: approved ? "HASH_MATCH" : "HASH_MISMATCH",
      evidenceHash: hashJson({ expected: input.expectedHash ?? null, actual: input.result.deliverableHash }),
      evaluatorId: this.id,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

const evaluationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reasonCode: z.string().min(1).max(128),
  evidenceHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  evaluatorId: z.string().min(1),
  evaluatedAt: z.string().datetime(),
});

export class HttpEvaluator implements EvaluatorAdapter {
  constructor(public readonly id: string, private readonly endpoint: URL) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Evaluator ${this.id} returned HTTP ${response.status}`);
    return evaluationSchema.parse(await response.json()) as EvaluationResult;
  }
}

export class HumanEvaluator implements EvaluatorAdapter {
  public readonly id = "human-confirmation";
  constructor(
    private readonly requestDecision: (
      input: EvaluationInput,
    ) => Promise<"approve" | "reject">,
  ) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const decision = await this.requestDecision(input);
    return {
      decision,
      reasonCode: decision === "approve" ? "HUMAN_APPROVED" : "HUMAN_REJECTED",
      evidenceHash: hashJson({ decision, deliverableHash: input.result.deliverableHash }),
      evaluatorId: this.id,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export class QuorumEvaluator implements EvaluatorAdapter {
  public readonly id = "quorum";
  constructor(
    private readonly members: EvaluatorAdapter[],
    private readonly threshold: number,
  ) {
    if (members.length === 0 || threshold <= 0 || threshold > members.length) {
      throw new Error("Invalid evaluator quorum");
    }
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const results = await Promise.all(this.members.map((member) => member.evaluate(input)));
    const approvals = results.filter((result) => result.decision === "approve").length;
    const decision = approvals >= this.threshold ? "approve" : "reject";
    return {
      decision,
      reasonCode: decision === "approve" ? "QUORUM_APPROVED" : "QUORUM_REJECTED",
      evidenceHash: hashJson(results),
      evaluatorId: this.id,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

