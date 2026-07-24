# Saga

Failure-safe settlement for multi-agent workflows. Built on Arc.

Saga is an independent application built on Arc Network. It coordinates dependent agent jobs under one bounded USDC budget. The
onchain coordinator is the source of truth for funding, dependency activation,
provider payouts, refunds, compensation, and a final workflow receipt. The
repository includes a Foundry contract MVP, a provider-agnostic TypeScript
orchestrator, deterministic x402 fixtures, and a Next.js frontend.

This project is independently developed and is not an official Arc or Circle
product. References to Arc describe the infrastructure used by the application
and do not imply endorsement, partnership, certification, or sponsorship.

## Why this exists

Single-job escrow can settle one task but cannot answer what happens to the
rest of a dependent business workflow when a middle step fails. Saga
freezes affected descendants, pays only completed valid work, preserves a
separately accounted compensation reserve, refunds unused USDC, and records the
full economic history in a readable receipt.

Compensation is an explicit new action. It is not a rollback and cannot reverse
an irreversible external effect.

## Repository layout

- `contracts/`: Solidity 0.8.30 contracts and Foundry tests.
- `packages/orchestrator/`: idempotent TypeScript engine, workers, agents,
  evaluators, indexer, and local x402 service.
- `apps/web/`: Next.js workflow builder, DAG/status views, receipts, proof page,
  and wallet/network UX.
- `docs/`: product, architecture, threat model, integration, deployment, and
  competitor audit material.

## Local verification

```powershell
pnpm install
pnpm --filter @agentsaga/web typecheck
pnpm --filter @agentsaga/orchestrator typecheck
pnpm --filter @agentsaga/orchestrator test
pnpm --filter @agentsaga/orchestrator exec prisma migrate deploy
& .\\.tools\\foundry\\forge.exe test
& .\\.tools\\foundry\\forge.exe coverage --ir-minimum --report summary
pnpm --filter @agentsaga/web build
```

The checked-in Foundry binary is under `.tools/foundry`. `pnpm install` may
require approving native build scripts on a fresh machine; no secrets are
needed for deterministic tests.

## Orchestrator operation modes

- `manual`: browser wallets perform writes; core readiness never claims autonomous execution.
- `hybrid`: configured backend role signers or adapters execute selected actions while unavailable capabilities remain durable waiting actions.
- `autonomous`: `/ready` succeeds only when core dependencies, fresh API/worker/indexer/scheduler heartbeats, every required signer, and every agent/evaluator capability are operational.

PostgreSQL, rather than BullMQ retention, is the lifecycle source of truth. It stores each stable logical action, waiting reason, due time, lease, execution attempts, and resume sequence. The scheduler re-enqueues a unique BullMQ execution attempt after prerequisites become ready.

## Arc status

This checkout is testnet-only and contains no fabricated deployment addresses,
transaction hashes, receipts, or endorsements. Populate
`deployments/arc-testnet.json` only after an operator deploys and verifies the
project-owned contracts. See `docs/DEPLOYMENT.md` and
`docs/TRANSACTION_EVIDENCE.md`.

## Differentiation

> Saga is not a marketplace, wallet, evaluator, or single-job escrow. It
> coordinates the financial lifecycle of multiple dependent agent jobs under
> one bounded workflow budget and produces a verifiable workflow-level
> settlement and compensation receipt.

## License

MIT. See `SECURITY.md` for reporting guidance and current limitations.
