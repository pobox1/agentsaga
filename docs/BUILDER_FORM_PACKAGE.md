# Builder form package

The Next.js builder supports up to 16 nodes, dependency checkboxes, cycle
validation, provider/evaluator addresses, service and compensation budgets,
expiry, metadata, compensation policy, and human approval. Totals use bigint
USDC base units and are passed to the factory without floating-point math.

The UI is convenience only: the contract repeats bounded graph and budget
validation, and funding is a separate exact-amount approval/deposit action.
