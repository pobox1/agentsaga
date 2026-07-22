# ERC-8183 integration

`AgentJobAdapter` preserves the observable ERC-8183 job shape: client,
provider, evaluator, budget, expiry, specification hash, deliverable hash,
evaluation reason, and final state. The coordinator creates one adapter job
per node and accepts completion only from the configured provider/evaluator.

The MVP uses a project-owned strict adapter because an official Arc ERC-8183
deployment must be verified before wiring production addresses. It does not
claim to be the official registry or silently alter ERC-8183 semantics.
