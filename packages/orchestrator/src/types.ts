import type { Hex } from "viem";

export interface AgentJobInput {
  workflowId: string;
  nodeId: number;
  specification: Record<string, unknown>;
  dependencyEvidence: readonly Hex[];
  maximumCost: bigint;
  signal?: AbortSignal;
}

export interface AgentJobResult {
  success: boolean;
  deliverableHash: Hex;
  evidenceUri: string;
  cost: string;
  startedAt: string;
  completedAt: string;
  failureCode?: string;
}

export interface WorkflowAgent {
  id: string;
  capabilities: string[];
  execute(input: AgentJobInput): Promise<AgentJobResult>;
}

export interface EvaluationInput {
  workflowId: string;
  nodeId: number;
  expectedHash?: Hex;
  result: AgentJobResult;
}

export interface EvaluationResult {
  decision: "approve" | "reject";
  reasonCode: string;
  evidenceHash: Hex;
  evaluatorId: string;
  evaluatedAt: string;
}

export interface EvaluatorAdapter {
  id: string;
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}

export interface WorkflowNodeDefinition {
  id: number;
  agentId: string;
  evaluatorId: string;
  dependencies: number[];
  maximumCost: bigint;
  specification: Record<string, unknown>;
  compensationAgentId?: string;
}

export interface WorkflowDefinition {
  id: string;
  nodes: WorkflowNodeDefinition[];
}

