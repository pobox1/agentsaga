# Deployment

Deploy only project-owned contracts to Arc Testnet after verifying the current
chain ID and official USDC address from Arc documentation. Configure
`ARC_TESTNET_RPC_URL`, deploy `PolicyRegistry` and `WorkflowFactory`, and
record owner, treasury, bytecode verification, transaction hashes, and blocks
in `deployments/arc-testnet.json`.

This repository intentionally leaves deployment fields empty until an
operator signs and funds the transactions. Never fill them with placeholders
that look like real evidence.
## Procedure

The safe deployment entrypoint is `contracts/script/DeployArcTestnet.s.sol`. It deploys only
AgentSaga-owned code: `PolicyRegistry` and `WorkflowFactory`; the factory constructor creates its
`WorkflowReceiptRegistry` and locked `WorkflowCoordinator` implementation. Each user workflow is a
deterministic EIP-1167 clone carrying immutable policy/workflow configuration.

Required non-secret environment:

```text
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
DEPLOYMENT_OWNER=0x...
DEPLOYMENT_TREASURY=0x...
```

Broadcast through a hardware wallet, encrypted Foundry keystore, or another operator-controlled
signer. Never put a private key in an environment file committed to the repository.

```bash
forge script contracts/script/DeployArcTestnet.s.sol:DeployArcTestnet \
  --rpc-url arc_testnet --broadcast
```

After confirmation, record transaction receipts and addresses in `deployments/arc-testnet.json`,
verify source on ArcScan, then run `pnpm --filter @agentsaga/contracts verify:deployment` with the
recorded addresses. Do not create the deployment JSON before those values exist onchain.
