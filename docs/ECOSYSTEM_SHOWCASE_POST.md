# Ecosystem showcase draft

AgentSaga is a testnet-only Arc protocol MVP for failure-safe settlement of
dependent agent work. It composes ERC-8183-shaped jobs under one USDC budget,
propagates failure onchain, pays completed providers, reserves compensation,
refunds unused funds, and emits a workflow-level receipt.

Verified locally: Foundry contract tests, fuzz/invariant tests, orchestrator
tests, TypeScript checks, and Next.js production build. Pending: operator-signed
Arc deployment, source verification, real Circle Wallet authentication, and
real x402 evidence. No Arc/Circle endorsement is implied.
