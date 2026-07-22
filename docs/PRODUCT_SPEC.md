# Product specification

The primary user is an operator funding one bounded business workflow. The
canonical demo is vendor onboarding: research, document validation, risk,
payment approval, and audit reconciliation.

The workflow owns a payment token, execution budget, service-fee budget,
compensation reserve, global deadline, DAG/specification commitments, metadata,
policy, and final receipt. A workflow has at most 16 nodes in the MVP.

Success completes every eligible node, pays valid providers, refunds unused
funds, and finalizes a receipt. A middle failure rejects the node, skips
descendants, leaves completed provider payments intact, optionally executes
compensation in reverse dependency order, refunds unused funds, and finalizes
an accurate partial/failure receipt.

Out of scope: marketplaces, tokens, NFTs, governance, arbitrary token custody,
or claims that external effects can be rolled back.
