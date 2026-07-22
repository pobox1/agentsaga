# Contributing

1. Create a focused branch and keep changes scoped.
2. Run `forge fmt --check`, `forge test`, both package typechecks, and the
   orchestrator Vitest suite.
3. Do not add secrets, fabricated chain evidence, or hidden model reasoning.
4. Update the relevant document when changing settlement semantics.
5. Include tests for every new state transition or accounting rule.

Use deterministic fixtures in CI. Real Arc, Circle, or x402 testnet actions
belong in an explicitly labelled manual run and must include their actual
transaction links.
