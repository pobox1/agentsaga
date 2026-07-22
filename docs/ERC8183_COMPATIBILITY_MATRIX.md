# ERC-8183 compatibility matrix

AgentSaga v1 uses a workflow-scoped job adapter. It does **not** claim full ERC-8183 compliance. ERC-8183 is currently a Draft EIP, so this matrix is pinned to the interface and lifecycle reviewed on 2026-07-22.

| ERC-8183 capability | AgentSaga v1 | Notes |
|---|---|---|
| Create job | Partial | Only the owning `WorkflowCoordinator` creates jobs from immutable DAG nodes. |
| Set provider | Restricted | Provider is fixed during coordinator construction; later assignment is unsupported. |
| Set budget | Compatible subset | Coordinator sets one bounded `uint96` budget before funding. |
| Fund | Compatible lifecycle | Assets stay in the coordinator vault; the adapter records reservation rather than custody. |
| Submit | Compatible subset | Provider commits a non-zero `bytes32` deliverable hash. |
| Complete | Compatible subset | Fixed evaluator decides; coordinator performs exact payout and accounting. |
| Reject | Compatible subset | Fixed evaluator rejects funded/submitted jobs; coordinator propagates failure and skips descendants. |
| Claim refund / expiry | Compatible subset | Permissionless expiry releases the coordinator reservation safely. |
| Hooks | Absent | ERC-8183 hooks are intentionally unsupported in v1. |
| Arbitrary clients | Absent | Adapter accepts calls only from its immutable coordinator. |
| Adapter custody | Different | USDC never moves into the adapter; coordinator remains the accounting vault. |
| Compensation | Extension | Remediation jobs reuse the bounded lifecycle; manual recovery never creates a fake job. |

The adapter should be described as “ERC-8183 lifecycle-inspired” or “an ERC-8183-compatible subset,” never as a conforming reference implementation. A future compliance claim requires conformance tests against the final EIP and official reference implementation.

Sources: [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183), [Arc ERC-8183 tutorial](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job).
