# Threat model

Trust boundaries are the owner wallet, untrusted providers/evaluators, the
orchestrator/indexer, ERC-20 token contract, and external agent/x402 services.
Assets are deposited USDC, reserved budgets, deliverable commitments, and the
final receipt.

Controls include SafeERC20, non-reentrancy, owner/evaluator/provider checks,
bounded 16-node graphs, dependency-mask validation, expiry checks, idempotent
worker keys, and explicit pause controls. Evidence URIs are commitments only;
the system never treats a URI or an AI answer as payment authorization by
itself. The MVP does not support fee-on-transfer tokens or unverified external
registries.
