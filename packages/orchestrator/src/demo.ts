import { createDemoAgents } from "./agents.js";
import { WorkflowEngine, InMemoryExecutionStore } from "./engine.js";
import { DeterministicSchemaEvaluator } from "./evaluators.js";
import type { WorkflowDefinition } from "./types.js";

export function vendorOnboardingDefinition(id: string): WorkflowDefinition {
  const names = ["research-agent", "document-agent", "risk-agent", "payment-agent", "audit-agent"];
  return {
    id,
    nodes: names.map((agentId, index) => ({
      id: index,
      agentId,
      evaluatorId: "deterministic-schema",
      dependencies: index === 0 ? [] : [index - 1],
      maximumCost: 10_000n,
      specification: { scenario: "vendor-onboarding", stage: agentId },
      ...(index < 2 ? { compensationAgentId: "compensation-agent" } : {}),
    })),
  };
}

export async function runLocalScenario(failRisk: boolean) {
  const engine = new WorkflowEngine(
    createDemoAgents(failRisk),
    [new DeterministicSchemaEvaluator()],
    new InMemoryExecutionStore(),
  );
  return engine.run(vendorOnboardingDefinition(failRisk ? "local-failure" : "local-success"));
}

