# x402 integration

The orchestrator exposes deterministic local x402 fixtures: a node requests a
paid resource, receives HTTP 402, checks its maximum cost, records a payment
fixture, and hashes the result into the deliverable commitment. Tests label
local/simulated evidence separately from real payments.

Current status: local deterministic fixtures and tests pass. No real x402
testnet transaction is claimed until one is executed and recorded.
