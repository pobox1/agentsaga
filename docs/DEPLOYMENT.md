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
# Persistent orchestrator processes

The orchestrator is not a Vercel serverless workload. Deploy the compiled package as four independently restarted processes sharing PostgreSQL, Redis and the same deployment configuration:

```text
pnpm --filter @agentsaga/orchestrator start
pnpm --filter @agentsaga/orchestrator start:worker
pnpm --filter @agentsaga/orchestrator start:indexer
pnpm --filter @agentsaga/orchestrator start:scheduler
```

Production configuration requires `DATABASE_URL`, `REDIS_URL`, at least one API token, `WORKFLOW_FACTORY_ADDRESS`, `FACTORY_DEPLOYMENT_BLOCK`, `OPERATION_MODE`, and an allowlisted `CORS_ORIGINS`. Run every Prisma migration before starting any process.

`/ready` separates `coreReady` from `autonomousReady`. Core readiness requires Arc RPC, PostgreSQL, Redis, applied migrations, queue access, deployment configuration, indexer cursor, and fresh worker/indexer/scheduler heartbeats. Autonomous readiness additionally requires every role signer and agent/evaluator capability. Manual and hybrid modes may serve HTTP 200 for core readiness while returning `autonomousReady: false`; autonomous mode returns HTTP 503 unless both levels are ready.

Configure separate owner/operator, provider, evaluator, compensation-provider, permissionless-expiry, and Circle signer scopes. The runtime verifies the selected address against fresh onchain role data before simulation and submission. Waiting prerequisites are durable PostgreSQL state; the scheduler leases and resumes them without consuming execution failure retries.
