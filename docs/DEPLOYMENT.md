# Deployment

Deploy only project-owned contracts to Arc Testnet after verifying the current
chain ID and official USDC address from Arc documentation. Configure
`ARC_TESTNET_RPC_URL`, deploy `PolicyRegistry` and `WorkflowFactory`, and
record owner, treasury, bytecode verification, transaction hashes, and blocks
in `deployments/arc-testnet.json`.

This repository intentionally leaves deployment fields empty until an
operator signs and funds the transactions. Never fill them with placeholders
that look like real evidence.
