import { hashJson } from "./hash.js";
import type {
  AgentJobResult,
  EvaluationResult,
  EvaluatorAdapter,
  WorkflowAgent,
  WorkflowDefinition,
  WorkflowNodeDefinition,
} from "./types.js";

export type EngineNodeStatus =
  | "blocked"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "compensated"
  | "compensation-unresolved";

export interface NodeExecutionRecord {
  nodeId: number;
  status: EngineNodeStatus;
  result?: AgentJobResult;
  evaluation?: EvaluationResult;
  compensation?: AgentJobResult;
}

export interface EngineReceipt {
  workflowId: string;
  finalStatus: "completed" | "partially-completed" | "failed";
  records: NodeExecutionRecord[];
  completedNodeIds: number[];
  failedNodeIds: number[];
  skippedNodeIds: number[];
  compensatedNodeIds: number[];
  evidenceRoot: `0x${string}`;
  mode: "local-deterministic-not-onchain";
}

export interface ExecutionStore {
  get(key: string): Promise<AgentJobResult | undefined>;
  putIfAbsent(key: string, value: AgentJobResult): Promise<AgentJobResult>;
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly results = new Map<string, AgentJobResult>();

  async get(key: string): Promise<AgentJobResult | undefined> {
    return this.results.get(key);
  }

  async putIfAbsent(key: string, value: AgentJobResult): Promise<AgentJobResult> {
    const existing = this.results.get(key);
    if (existing !== undefined) return existing;
    this.results.set(key, value);
    return value;
  }
}

export class WorkflowEngine {
  private readonly agents = new Map<string, WorkflowAgent>();
  private readonly evaluators = new Map<string, EvaluatorAdapter>();

  constructor(
    agents: WorkflowAgent[],
    evaluators: EvaluatorAdapter[],
    private readonly store: ExecutionStore,
  ) {
    for (const agent of agents) this.agents.set(agent.id, agent);
    for (const evaluator of evaluators) this.evaluators.set(evaluator.id, evaluator);
  }

  async run(definition: WorkflowDefinition): Promise<EngineReceipt> {
    validateDefinition(definition);
    const records = definition.nodes.map<NodeExecutionRecord>((node) => ({
      nodeId: node.id,
      status: node.dependencies.length === 0 ? "ready" : "blocked",
    }));
    const evidence: `0x${string}`[] = [];

    for (const node of definition.nodes) {
      const record = records[node.id];
      if (record === undefined) throw new Error(`Missing record for node ${node.id}`);
      if (node.dependencies.some((dependency) => records[dependency]?.status !== "completed")) {
        record.status = "skipped";
        continue;
      }
      record.status = "running";
      const result = await this.executeIdempotently(definition.id, node, evidence);
      record.result = result;
      evidence.push(result.deliverableHash);
      if (BigInt(result.cost) > node.maximumCost) {
        record.status = "failed";
        record.evaluation = budgetRejectedEvaluation(node, result);
        continue;
      }
      const evaluator = this.evaluators.get(node.evaluatorId);
      if (evaluator === undefined) throw new Error(`Unknown evaluator: ${node.evaluatorId}`);
      const evaluation = await evaluator.evaluate({
        workflowId: definition.id,
        nodeId: node.id,
        result,
      });
      record.evaluation = evaluation;
      evidence.push(evaluation.evidenceHash);
      record.status = evaluation.decision === "approve" ? "completed" : "failed";
    }

    const failed = records.filter((record) => record.status === "failed");
    if (failed.length > 0) {
      markTransitiveDescendantsSkipped(definition, records, new Set(failed.map((item) => item.nodeId)));
      await this.compensate(definition, records, evidence);
    }

    const completedNodeIds = idsWithStatus(records, "completed");
    const failedNodeIds = idsWithStatus(records, "failed");
    const skippedNodeIds = idsWithStatus(records, "skipped");
    const compensatedNodeIds = idsWithStatus(records, "compensated");
    const finalStatus = failedNodeIds.length === 0
      ? "completed"
      : completedNodeIds.length === 0 && compensatedNodeIds.length === 0
        ? "failed"
        : "partially-completed";
    return {
      workflowId: definition.id,
      finalStatus,
      records,
      completedNodeIds,
      failedNodeIds,
      skippedNodeIds,
      compensatedNodeIds,
      evidenceRoot: hashJson(evidence),
      mode: "local-deterministic-not-onchain",
    };
  }

  private async executeIdempotently(
    workflowId: string,
    node: WorkflowNodeDefinition,
    dependencyEvidence: readonly `0x${string}`[],
  ): Promise<AgentJobResult> {
    const key = `${workflowId}:${node.id}:execute`;
    const existing = await this.store.get(key);
    if (existing !== undefined) return existing;
    const agent = this.agents.get(node.agentId);
    if (agent === undefined) throw new Error(`Unknown agent: ${node.agentId}`);
    const result = await agent.execute({
      workflowId,
      nodeId: node.id,
      specification: node.specification,
      dependencyEvidence,
      maximumCost: node.maximumCost,
    });
    return this.store.putIfAbsent(key, result);
  }

  private async compensate(
    definition: WorkflowDefinition,
    records: NodeExecutionRecord[],
    evidence: `0x${string}`[],
  ): Promise<void> {
    for (const node of [...definition.nodes].reverse()) {
      const record = records[node.id];
      if (record?.status !== "completed" || node.compensationAgentId === undefined) continue;
      const agent = this.agents.get(node.compensationAgentId);
      if (agent === undefined) {
        record.status = "compensation-unresolved";
        continue;
      }
      const result = await agent.execute({
        workflowId: definition.id,
        nodeId: node.id,
        specification: { action: "compensate", original: node.specification },
        dependencyEvidence: evidence,
        maximumCost: node.maximumCost,
      });
      record.compensation = result;
      evidence.push(result.deliverableHash);
      record.status = result.success ? "compensated" : "compensation-unresolved";
    }
  }
}

function validateDefinition(definition: WorkflowDefinition): void {
  if (definition.nodes.length === 0 || definition.nodes.length > 16) {
    throw new Error("Workflow must contain 1 to 16 nodes");
  }
  definition.nodes.forEach((node, index) => {
    if (node.id !== index) throw new Error("Nodes must use canonical topological IDs");
    if (node.dependencies.some((dependency) => dependency < 0 || dependency >= index)) {
      throw new Error(`Node ${node.id} has a non-topological dependency`);
    }
    if (new Set(node.dependencies).size !== node.dependencies.length) {
      throw new Error(`Node ${node.id} contains duplicate dependencies`);
    }
  });
}

function markTransitiveDescendantsSkipped(
  definition: WorkflowDefinition,
  records: NodeExecutionRecord[],
  stopped: Set<number>,
): void {
  for (const node of definition.nodes) {
    if (!node.dependencies.some((dependency) => stopped.has(dependency))) continue;
    stopped.add(node.id);
    const record = records[node.id];
    if (record !== undefined && record.status !== "failed") record.status = "skipped";
  }
}

function idsWithStatus(records: NodeExecutionRecord[], status: EngineNodeStatus): number[] {
  return records.filter((record) => record.status === status).map((record) => record.nodeId);
}

function budgetRejectedEvaluation(
  node: WorkflowNodeDefinition,
  result: AgentJobResult,
): EvaluationResult {
  return {
    decision: "reject",
    reasonCode: "NODE_BUDGET_EXCEEDED",
    evidenceHash: hashJson({ nodeId: node.id, maximum: node.maximumCost.toString(), cost: result.cost }),
    evaluatorId: "orchestrator-budget-guard",
    evaluatedAt: new Date().toISOString(),
  };
}

