import { z } from "zod";
import { hashJson } from "./hash.js";
import type { AgentJobInput, AgentJobResult, WorkflowAgent } from "./types.js";

type DeterministicRule = (
  input: AgentJobInput,
) => { success: boolean; output: Record<string, unknown>; cost: bigint; failureCode?: string };

export class DeterministicAgent implements WorkflowAgent {
  constructor(
    public readonly id: string,
    public readonly capabilities: string[],
    private readonly rule: DeterministicRule,
  ) {}

  async execute(input: AgentJobInput): Promise<AgentJobResult> {
    const startedAt = new Date().toISOString();
    const outcome = this.rule(input);
    const deliverableHash = hashJson({
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      agentId: this.id,
      output: outcome.output,
    });
    const result: AgentJobResult = {
      success: outcome.success,
      deliverableHash,
      evidenceUri: `urn:agentsaga:local:${deliverableHash}`,
      cost: outcome.cost.toString(),
      startedAt,
      completedAt: new Date().toISOString(),
    };
    if (outcome.failureCode !== undefined) result.failureCode = outcome.failureCode;
    return result;
  }
}

const resultSchema = z.object({
  success: z.boolean(),
  deliverableHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  evidenceUri: z.string().min(1).max(2_048),
  cost: z.string().regex(/^\d+$/),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  failureCode: z.string().max(128).optional(),
});

export class HttpAgentAdapter implements WorkflowAgent {
  constructor(
    public readonly id: string,
    public readonly capabilities: string[],
    private readonly endpoint: URL,
    private readonly authorization?: string,
  ) {}

  async execute(input: AgentJobInput): Promise<AgentJobResult> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authorization !== undefined) headers.authorization = this.authorization;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, maximumCost: input.maximumCost.toString(), signal: undefined }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!response.ok) throw new Error(`Agent ${this.id} returned HTTP ${response.status}`);
    return resultSchema.parse(await response.json()) as AgentJobResult;
  }
}

export class McpAgentAdapter implements WorkflowAgent {
  constructor(
    public readonly id: string,
    public readonly capabilities: string[],
    private readonly endpoint: URL,
    private readonly toolName = "execute_workflow_job",
  ) {}

  async execute(input: AgentJobInput): Promise<AgentJobResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${input.workflowId}:${input.nodeId}`,
        method: "tools/call",
        params: {
          name: this.toolName,
          arguments: { ...input, maximumCost: input.maximumCost.toString(), signal: undefined },
        },
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!response.ok) throw new Error(`MCP agent ${this.id} returned HTTP ${response.status}`);
    const envelope = z
      .object({ result: z.object({ structuredContent: resultSchema }) })
      .parse(await response.json());
    return envelope.result.structuredContent as AgentJobResult;
  }
}

export class OpenAiCompatibleAgent implements WorkflowAgent {
  constructor(
    public readonly id: string,
    public readonly capabilities: string[],
    private readonly endpoint: URL,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async execute(input: AgentJobInput): Promise<AgentJobResult> {
    const startedAt = new Date().toISOString();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return JSON with success, output, costBaseUnits, and optional failureCode. Do not return hidden reasoning.",
          },
          { role: "user", content: JSON.stringify(input.specification) },
        ],
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!response.ok) throw new Error(`Model adapter returned HTTP ${response.status}`);
    const envelope = z
      .object({
        choices: z.array(
          z.object({ message: z.object({ content: z.string() }) }),
        ).min(1),
      })
      .parse(await response.json());
    const content = envelope.choices[0]?.message.content;
    if (content === undefined) throw new Error("Model adapter returned no content");
    const parsed = z
      .object({
        success: z.boolean(),
        output: z.record(z.string(), z.unknown()),
        costBaseUnits: z.string().regex(/^\d+$/),
        failureCode: z.string().optional(),
      })
      .parse(JSON.parse(content));
    const deliverableHash = hashJson(parsed.output);
    const result: AgentJobResult = {
      success: parsed.success,
      deliverableHash,
      evidenceUri: `urn:agentsaga:model-output:${deliverableHash}`,
      cost: parsed.costBaseUnits,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    if (parsed.failureCode !== undefined) result.failureCode = parsed.failureCode;
    return result;
  }
}

export function createDemoAgents(failRisk = false): WorkflowAgent[] {
  const pass = (label: string, cost: bigint): DeterministicRule => (input) => ({
    success: true,
    output: { label, specification: input.specification, dependencyEvidence: input.dependencyEvidence },
    cost,
  });
  return [
    new DeterministicAgent("research-agent", ["vendor-research", "x402-data"], pass("research", 1_000n)),
    new DeterministicAgent("document-agent", ["document-validation"], pass("document", 2_000n)),
    new DeterministicAgent("risk-agent", ["counterparty-risk"], (input) => ({
      success: !failRisk,
      output: { label: "risk", checked: true, specification: input.specification },
      cost: 3_000n,
      ...(failRisk ? { failureCode: "RISK_POLICY_REJECTED" } : {}),
    })),
    new DeterministicAgent("payment-agent", ["payment-approval"], pass("payment", 1_500n)),
    new DeterministicAgent("audit-agent", ["reconciliation"], pass("audit", 1_000n)),
    new DeterministicAgent("compensation-agent", ["remediation"], pass("compensation", 2_500n)),
  ];
}
