# AgentSaga Final Runtime Gap Audit

Audit date: 2026-07-22

Branch baseline: `main` at `704a7d9d5f743b80444293d0d71faa340688c213`

Working branch: `agent/final-runtime-and-deployment-readiness`

PR #1: merged at `704a7d9d5f743b80444293d0d71faa340688c213` on 2026-07-22.

Latest successful `main` CI: [run 29928574752](https://github.com/pobox1/agentsaga/actions/runs/29928574752).

Deployment manifest: `not-deployed`; no project-owned Arc Testnet addresses or transaction hashes exist.

Vercel: project `agentsaga` is linked. The latest ready deployment is an approximately nine-hour-old preview (`dpl_5tznciqthc3F1nv9TU2WFLsPGKew`); the latest production attempt is in error. The CLI reports no production environment variables. The CLI did not expose a Git commit for the ready preview, so its commit is unverified.

Orchestrator: `DATABASE_URL`, `REDIS_URL`, API auth, deployer owner/treasury and deployment RPC variables are not configured in the current environment. No persistent API, worker or indexer service is verified.

## Post-review confirmed blockers

Starting SHA: `a5f832fbf35a45a31d18b8cf0e706d3dc33e1cc6`.

- Worker prerequisites are returned as successful BullMQ results and persisted ambiguously; waiting actions have no durable due-time scheduler, independent resume counter, or concurrency-safe claim lease.
- Processor registration heartbeats are treated as operational readiness even when required signers, agent adapters, evaluator adapters, or scheduler capability are unavailable.
- Signer resolution is not yet role-separated or checked against fresh onchain roles before writes.
- `WorkflowFunded` writes the database lifecycle status back to `funded`, which can overwrite the authoritative later `Active` transition emitted in the same transaction.
- The indexer models one transaction action and one mutable node `jobId`; it does not preserve multi-event transaction history or original versus compensation jobs.
- Browser transaction persistence waits for `getTransaction` nonce enrichment after wallet submission, so temporary RPC unavailability can lose the only durable pending record.
- Confirmed receipts with incomplete event verification can be surfaced as generic failures, and expiry/cancellation visibility needs stricter lifecycle guards.
- Most registered worker processors still return placeholder outcomes rather than executing or durably waiting for the real lifecycle operation.
- Existing tests prove registration and isolated behavior but do not yet prove PostgreSQL/Redis/Anvil waiting-resume, restart recovery, lifecycle idempotency, or receipt indexing.

The deployment manifest remains `not-deployed`. No Arc Testnet deployment, transaction, live PostgreSQL/Redis status, Circle wallet activity, x402 payment, or public production availability is claimed.

## Second post-review blockers

Starting SHA: `c57fed8bb631ab1011bb726299e42a60680a9f55`.

- **Resolved locally:** migration readiness discovers every repository migration dynamically and rejects missing, failed, unfinished, or rolled-back applications; it has no historical migration-name constant.
- **Resolved locally:** the worker bootstraps validated, role-separated `disabled`, `manual`, encrypted-local testnet, Circle, and named external signer adapters, with no plaintext-key environment variable.
- **Resolved locally:** API, worker, indexer, and scheduler consume the shared validated capability configuration and publish a compatible version/hash.
- **Resolved locally:** autonomous readiness uses factual worker processor, dependency, signer, and adapter status; a configured declaration alone cannot make a processor operational.
- **Resolved locally:** backend writes persist the returned hash atomically before nullable nonce enrichment, recover existing hashes, and record confirming, paused-recovery, revert, and verification outcomes without implicit replacement.
- **Resolved locally:** service and remediation jobs/executions have separate context and idempotency; compensation uses the active adapter job and action-specific state predicates.
- **Resolved locally:** frontend compensation cards and preflight derive provider, evaluator, budget, expiry, and status from the active remediation job.
- **Resolved locally:** raw event ingestion is durable and idempotent while projection has received/processing/processed/failed states, retry metadata, and restart-safe replay.
- **Resolved locally:** forward-only migrations `202607230005_runtime_truth_and_projection_retry` and `202607230006_stable_index_names` apply cleanly and produce no datamodel drift on the local PostgreSQL 16 test database.
- **Resolved locally:** the automatic success and failure/compensation tests keep real BullMQ workers active and do not directly invoke processors for lifecycle stages.
- **Resolved locally:** processes validate configuration, publish shared runtime heartbeats, surface heartbeat failures, and close workers, Redis, and Prisma gracefully.
- **Resolved locally:** waiting prerequisites preserve execution attempts; resume sequence and execution attempt produce fresh BullMQ attempt IDs, and concurrent scheduler claims remain idempotent.
- **Resolved locally:** write processors use explicit action-specific fresh-chain predicates rather than generic numeric status ordering.
- **Resolved locally:** expiry remains distinct from evaluator rejection, `WorkflowStatusChanged` remains authoritative, and reconciliation reads canonical Arc state.
- **Resolved locally:** `/ready` and `/metrics` expose migration, factual capability, signer-role availability, adapter, projection backlog/failure, queue, dead-letter, process, and recovery signals without addresses or secrets.
- **Preserved truthfully:** `deployments/arc-testnet.json` remains `not-deployed`; no production, Circle, x402, Vercel, address, or transaction evidence is claimed.

Local evidence on 2026-07-23: orchestrator unit tests 32 passed with 5 integration-gated tests skipped; web tests 41 passed; the separately enabled PostgreSQL 16 + Redis 7 + Anvil 5042002 suite passed all 5 tests, including automatic success, automatic five-node failure/reverse compensation with distinct remediation roles, hash-first worker restart recovery without resend, concurrent scheduler claims, and projection retry after durable ingestion. Remote CI evidence is recorded only after the pushed commit's workflow completes.

This audit uses only these classifications:

- **verified and working**
- **implemented but local only**
- **implemented but disconnected**
- **implemented but broken**
- **absent**
- **blocked by operator action**

## Runtime blockers

| Feature | Classification | Verified evidence |
| --- | --- | --- |
| Cancellation and compensation contract safety | **verified and working** | Merged Foundry tests and invariants cover activation cancellation guards and compensation expiry. |
| Generated ABI and enum mapping | **verified and working** | Bindings are artifact-generated and checked by CI. |
| Action-specific event verification | **verified and working** | Version-two records route every action to an explicit verifier with emitter and real event-field checks; successful receipts fall back to fresh state. |
| Adapter/coordinator job matching | **verified and working** | Frontend confirmations prefer coordinator lifecycle events and persist `expectedJobId`; adapter events remain supplementary index evidence. |
| Provisional transaction persistence | **verified and working** | Version-three records persist hash and sender immediately with nullable nonce; bounded asynchronous enrichment cannot delete the record, receipt recovery works first, and replacement checks require a known nonce. |
| Bounded recovery | **verified and working** | Exponential eligibility, eight automatic attempts, pause, manual retry, dismiss, and terminal incomplete-confirmation states prevent endless polling. |
| Transaction recovery tests | **verified and working** | Vitest covers all action dispatch paths plus emitter, ownerless event, node/job, state fallback, revert, replacement, temporary unavailability, retry limit, dismiss, nonce and migration. |
| Role-aware frontend actions | **implemented but local only** | Fresh wallet, chain, node, role, expiry, activation and compensation-order reads run before simulation; no deployed contracts exist for browser verification. |
| Builder completeness | **implemented but local only** | Builder captures optional agent IDs as metadata, per-node expiry/URI/compensation spec, explicit review, predicted address, gas estimate and exact USDC envelope. |
| BullMQ and durable scheduler | **verified and working locally** | Fifteen processors plus a PostgreSQL-backed scheduler use stable logical keys, unique execution-attempt IDs, leases, independent counters, and PostgreSQL/Redis integration tests. Production Redis remains unconfigured. |
| Worker runtime | **implemented but disconnected** | Deterministic agent/evaluator plus activate, submit, complete/reject, expiry, reconciliation and receipt paths use fresh RPC state and role-separated signer resolution. Production signers/external adapters are not configured. |
| Indexer process | **implemented but disconnected** | `WorkflowStatusChanged` is authoritative; `WorkflowFunded` updates financial state only, reconciliation refreshes masks, and multi-event plus original/remediation job history is preserved. No deployed start block exists. |
| PostgreSQL repositories | **implemented but disconnected** | Prisma models/migrations exist; no live database or applied production migration is verified. |
| Redis and queues | **implemented but disconnected** | BullMQ runtime exists; no live Redis or processor registry is verified. |
| Production readiness endpoint | **verified and working locally** | `/ready` separates core/autonomous readiness, checks migrations and fresh worker/indexer/scheduler plus processor heartbeats, and cannot call missing signers/adapters autonomous. Live production infrastructure is absent. |
| Public orchestrator APIs | **implemented but local only** | Workflow, node, event, execution, transaction, receipt, agent, queue and authenticated DLQ/retry routes are implemented and typechecked. |
| Arc Testnet contracts | **blocked by operator action** | Secure funded signer, owner and treasury choices are absent; manifest remains truthful. |
| Successful and failed workflows | **blocked by operator action** | Require deployed contracts and funded role wallets. |
| ERC-8004 identity display | **implemented but local only** | Owner/token URI reads exist; metadata/capability/endpoint/validation/reputation views are incomplete. |
| Circle Agent Wallet | **implemented but disconnected** | Backend wrapper exists; no operator authentication, verified wallet or transaction. |
| Real x402 | **implemented but disconnected** | Local fixture passes; no approved service, replay persistence or real payment evidence. |
| Public Vercel production | **blocked by operator action** | No contract/orchestrator addresses, WalletConnect ID or production environment variables; latest production deployment failed. |
| Persistent orchestrator deployment | **blocked by operator action** | Requires a host, PostgreSQL, Redis, HTTPS and secret-manager configuration. |
| Proof of Build real evidence | **absent** | No deployment, workflow, Circle or x402 transaction evidence exists and none is inferred. |

## Implementation order

1. Replace version-one recovery records and generic event checks with version-two action-specific verification, nonce persistence and bounded recovery.
2. Correct every frontend write expectation and transaction-center control.
3. Add real API, worker and indexer process entrypoints, signer roles, processors and persistent worker state.
4. Complete readiness, reconciliation and missing APIs; add regression and integration tests.
5. Re-run the complete contract, TypeScript, browser, security and remote CI gates.
6. Stop at secure operator signatures and infrastructure credentials; never create deployment evidence before it exists.

## Verification completed on the working branch

- Foundry: 41/41 tests pass, including seven stateful invariants at 256 runs and 16,384 calls each.
- Contract size: `WorkflowCoordinator` runtime is 24,507 bytes, leaving only 69 bytes below EIP-170. No receipt fields were added to it.
- Coverage with `--ir-minimum`: 84.41% lines, 81.01% statements, 31.61% branches, 90.20% functions. Foundry reported source-map anchor warnings, so branch coverage is not overstated.
- Gas snapshot: passes unchanged.
- TypeScript, ESLint, generated ABI drift, 32 frontend tests, eight orchestrator tests, production Next.js build, orchestrator build and truthful `not-deployed` manifest validation pass locally.
- `forge fmt --check` reports whole-file newline diffs in this Windows checkout; no Solidity source is changed by this branch and the semantic build/test gates pass. Remote Linux CI remains authoritative for the formatting job.
- Slither and Gitleaks executables are not installed locally. Their results must come from the remote CI jobs; no result is claimed here.

## Final contract review

The existing tests re-verified deterministic clone initialization/address prediction, cancellation guarded by `activationMask`, funded and submitted compensation expiry, pause escape paths, exact vault accounting, single finalization, bounded fees/refunds, reentrancy resistance, fee-on-transfer rejection, metadata limits and the 16-node maximum. The 69-byte coordinator margin makes direct receipt-schema expansion unsafe for this iteration; supplemental receipt/factory indexing remains the documented Arc Testnet MVP path.
