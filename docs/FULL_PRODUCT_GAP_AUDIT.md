# AgentSaga full product gap audit

Audit date: 2026-07-22  
Starting commit: `171e431c013f27497e87a1ceef27fa6190ee43b2`

The working tree was clean and `main` was current with `origin/main` before this audit.
No deployment, workflow, identity, Circle Wallet, or x402 transaction is treated as real without
independent RPC evidence.

## Official Arc baseline

| Item | Verified value / status | Primary source |
|---|---|---|
| Network | Arc Testnet | https://docs.arc.io/arc/references/connect-to-arc |
| Chain ID | `5042002` | https://docs.arc.io/arc/references/connect-to-arc |
| RPC | `https://rpc.testnet.arc.network` | https://docs.arc.io/arc/references/connect-to-arc |
| Explorer | `https://testnet.arcscan.app` | https://docs.arc.io/arc/references/connect-to-arc |
| Native gas asset | USDC, 18-decimal native representation | https://docs.arc.io/arc/references/connect-to-arc |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000`, 6 decimals | https://docs.arc.io/arc/references/contract-addresses |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | https://docs.arc.io/arc/tutorials/register-your-first-ai-agent |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | https://docs.arc.io/arc/tutorials/register-your-first-ai-agent |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | https://docs.arc.io/arc/tutorials/register-your-first-ai-agent |
| ERC-8183 status | Draft ERC | https://eips.ethereum.org/EIPS/eip-8183 |
| Arc ERC-8183 reference deployment | `0x0747EEf0706327138c69792bF28Cd525089e4583` | https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job |

## Status legend

- **Implemented and verified**: exercised by a deterministic local test/build.
- **Implemented but local only**: working code without public Arc or hosted-service evidence.
- **Implemented but not connected**: integration boundary exists but has no production credentials
  or infrastructure.
- **Incomplete**: meaningful code exists but required behavior is missing.
- **Absent**: no implementation exists.
- **Blocked by external operator action**: all safe code work can be completed, but a signature,
  funding, OTP, service provisioning, or verification approval is required.

## Contracts

| Capability | Status before remediation | Gap |
|---|---|---|
| DAG validation and dependency activation | Implemented and verified | Only canonical topological IDs are supported; this is documented trust-minimizing validation, not arbitrary-order cycle detection. |
| Exact USDC accounting | Implemented and verified | More adversarial token/reentrancy tests were missing. |
| Failure propagation and descendant skipping | Implemented and verified | Receipt omitted the skipped mask. |
| Compensation | Incomplete | Six enum values were advertised, but every non-`None` value used the same autonomous job path. `ManualRecovery` was semantically false. |
| Policy snapshot | Incomplete | Fee, treasury, threshold, and version were snapshotted, but compensation selection called the mutable registry later. |
| Emergency pause | Incomplete | Correctly blocked funding/activation, but also blocked completion of valid submitted work. |
| Final receipt | Incomplete | Missing payment token, node count, skipped/unresolved masks, DAG hash, policy version, deadline, and configured compensation reserve. |
| Evidence commitment | Incomplete naming | A sequential hash accumulator was called a Merkle root although no reproducible Merkle proofs existed. |
| Metadata bounds | Absent | Workflow/node/job strings were unbounded. |
| Address prediction | Absent | CREATE2 was used but no public prediction helper existed. |
| ERC-8183 integration | Implemented but local only | Workflow-scoped adapter has similar states but does not implement the full official interface/hook/negotiation surface. It must not claim full compliance. |
| Arc deployment | Blocked by external operator action | No project-owned deployment transaction or source verification exists. |

## Frontend

| Capability | Status before remediation | Gap |
|---|---|---|
| Routes and public RPC reads | Implemented but local only | No configured deployment addresses. |
| Wallet connection | Incomplete | Automatically selected the first injected connector; no chooser, WalletConnect, unavailable state, or robust recovery. |
| Production environment validation | Absent | Missing required-variable validation and production fail-fast behavior. |
| Workflow creation | Incomplete | Submitted a transaction but did not persist/recover it, decode/verify `WorkflowCreated`, store the workflow, or navigate. |
| Exact funding | Absent | No allowance, exact approval, funding transaction, decoding, or recovery flow. |
| Workflow detail | Incomplete | Read aggregate fields only; did not call `getNode` or expose role-aware actions. |
| Receipts | Incomplete | Rendered the old truncated receipt and mislabeled the accumulator as a root. |
| ERC-8004 agents | Implemented but not connected | Static local runtime cards only; no onchain identity ownership inspection or registration flow. |

## Orchestrator and infrastructure

| Capability | Status before remediation | Gap |
|---|---|---|
| Deterministic agents/evaluators | Implemented and verified | Local evidence only. |
| HTTP/MCP/model adapters | Implemented but not connected | No production endpoint configuration or durable execution records. |
| Event indexer | Implemented but local only | In-memory cursor/log store only. |
| Idempotent worker abstraction | Implemented but local only | In-memory action ledger; no locks, retries, queues, or DLQ. |
| PostgreSQL schema | Incomplete | Schema existed without migration, generated-client runtime, or repository implementations. |
| Redis/BullMQ | Absent | Dependency existed for BullMQ but no queue topology or Redis lifecycle. |
| Service hardening | Incomplete | Bound to localhost; no strict config, auth, rate limits, metrics/version, dependency readiness, or graceful shutdown. |
| Arc-driven orchestration | Absent | No event-to-action production pipeline and no RPC revalidation before writes. |
| Circle Agent Wallet | Absent | No backend-only adapter; operator credentials/authentication are not configured. |
| Real x402 | Implemented but local only | Deterministic 402 fixture is correctly labelled; no real service/payment evidence. |
| Persistent deployment | Blocked by external operator action | Requires a persistent host, PostgreSQL, Redis, and their non-public connection configuration. |

## Tests and delivery

| Capability | Status before remediation | Gap |
|---|---|---|
| Foundry tests | Implemented and verified | 17 tests passed, but lifecycle pause, policy snapshot, token adversaries, max graph, receipt completeness, and compensation-type coverage were missing. |
| TypeScript tests | Implemented and verified | Six orchestrator tests; no frontend tests or browser suite. |
| CI | Incomplete | Only Foundry format/test and TypeScript typecheck/test/build. No completed remote run is claimed green. |
| Vercel | Implemented but not connected | Existing preview deployment is protected/manual and is not proof of a public production site. |
| Proof of Build | Incomplete | Honest placeholders exist; all public transaction evidence remains absent. |

## External operator gates

The following cannot be completed without external authority or funded infrastructure:

1. Arc deployer signature and enough Arc Testnet USDC for gas and workflows.
2. ArcScan source-verification submission if the explorer requires interactive approval/API setup.
3. Circle Developer authentication/entity-secret setup or OTP/session approval.
4. A real x402-compatible service and supported testnet payment method.
5. PostgreSQL, Redis, and a persistent worker host connection configuration.
6. Vercel production promotion, stable alias, and disabling deployment protection if account policy
   requires an owner confirmation.

All code, deterministic tests, deployment scripts, and verification checks should be completed
before stopping at these gates.

## Post-remediation verification

The remediation implemented the contract, frontend, and infrastructure items identified above,
but it does not change any external item to “verified” without public evidence. In particular:

- Compensation v1 is restricted to `None`, `RemediationJob`, and `ManualRecovery`; manual recovery
  cannot create an autonomous job. Funded workflows use snapshotted policy values.
- Pause blocks creation, funding, and activation while allowing submitted-job completion, expiry,
  refund, compensation resolution, and finalization.
- Receipts and TypeScript ABI now include token, node count, skipped/unresolved masks, DAG hash,
  policy version, deadline, reserve, and an honestly named `evidenceAccumulator`.
- Workflow deployments use deterministic EIP-1167 clones with immutable arguments. With optimizer
  runs set to 1, the coordinator implementation is 24,233 bytes (343 bytes under EIP-170), and the
  factory is 5,578 bytes. Factory validation occurs before atomic clone initialization.
- Local verification passes 31 Foundry tests, including 512-case fuzzing, seven stateful
  invariants, fee-on-transfer and reentrancy adversaries. Deployment gas is approximately 1.57M,
  2.85M, 4.46M, and 6.38M for 1, 5, 10, and 16 nodes respectively.
- The web app implements wallet choice, chain revalidation, simulated writes, recoverable pending
  hashes, verified creation event decoding, exact USDC approval/funding, per-node reads/actions,
  complete public receipts, and ERC-8004 identity inspection/registration.
- PostgreSQL repositories/migration, Redis/BullMQ queues, authentication, request validation,
  rate limiting, health/readiness/metrics/version endpoints, redacted logging, and graceful
  shutdown are implemented but remain unconnected until infrastructure is provisioned.
- The Circle adapter uses the official backend CLI and the real-x402 path validates the 402
  requirement before payment. Neither is represented as real evidence until the operator session,
  funding, and a public transaction exist.
