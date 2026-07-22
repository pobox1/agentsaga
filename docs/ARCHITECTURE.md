# Architecture

`WorkflowFactory` deploys a non-upgradeable `WorkflowCoordinator` for each
workflow and registers it in `WorkflowReceiptRegistry`. The coordinator owns
the workflow accounting and a strict ERC-8183-shaped `AgentJobAdapter`.
`PolicyRegistry` bounds the token, budgets, deadlines, providers, evaluators,
and emergency pause. The coordinator reserves node budgets and compensation
funds and emits every transition.

The TypeScript orchestrator is a replaceable scheduler/indexer. It can execute
deterministic, HTTP, MCP, or OpenAI-compatible agents and evaluators, but it
cannot bypass onchain dependency or accounting checks. The Next.js app reads
public state through Arc RPC and wallet connectors.

Accounting invariant:

`deposited = available + reservedForJobs + reservedForCompensation + paidToProviders + compensationSpent + refunded + protocolFees`.

Arc, not PostgreSQL or a worker, is the settlement source of truth.
