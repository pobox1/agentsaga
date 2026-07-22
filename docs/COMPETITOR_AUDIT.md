# AgentSaga competitor and differentiation audit

Research date: 2026-07-22. Public product claims were treated as claims unless an official
contract, repository, explorer transaction, or standards document independently supported them.
Statuses can change after this date.

## Stop-condition result

No public project in this audit was found to provide the complete AgentSaga feature combination
on Arc: an onchain DAG of multiple ERC-8183-compatible jobs, one workflow-level budget,
a separately accounted compensation reserve, deterministic downstream failure propagation, and a
permanent workflow-level financial receipt. Individual parts exist and are useful; the complete
combination was not found. The implementation therefore proceeds.

## Standards and official infrastructure

| Project | URL | Chain / status | Identity | Marketplace / bidding | Escrow / evaluator | DAG / workflow budget | Compensation / rollback | Workflow receipt | Overlap and exact differentiation |
|---|---|---|---|---|---|---|---|---|---|
| Arc Agentic Economy | https://docs.arc.io/build/agentic-economy | Arc Testnet; official docs | ERC-8004 | No marketplace primitive | ERC-8183 job lifecycle | No workflow-level DAG or shared budget | No Saga compensation protocol | Per-job events, not an aggregate workflow receipt | Supplies the identity and single-job settlement primitives AgentSaga composes. |
| ERC-8004 | https://eips.ethereum.org/EIPS/eip-8004 | EVM; draft ERC | Identity, reputation, validation registries | Discovery metadata only | Validation signals, no payment escrow | None | None | Identity/reputation records only | AgentSaga references official Arc registries but does not treat reputation as proof of capability. |
| ERC-8183 | https://eips.ethereum.org/EIPS/eip-8183 | EVM; draft ERC | Optional ERC-8004 hooks | Optional provider assignment; bidding via hooks | Single-job escrow and evaluator | No multi-job DAG or shared budget | Refund/expiry only; no workflow compensation | Per-job lifecycle events | AgentSaga preserves observable job semantics while adding workflow-wide dependencies and accounting. |
| Arc escrow sample | https://docs.arc.io/arc/references/sample-applications | Arc sample app | Circle wallets | No | Conditional single escrow with AI-assisted validation | No | Refund protocol, not Saga compensation | No aggregate DAG receipt | Reference for escrow UX; AgentSaga is multi-job and does not rely on an AI verdict alone for sensitive payments. |
| Circle Agent Stack | https://developers.circle.com/agent-stack | Multichain; available | Agent Wallets and policies | Curated Agent Marketplace | x402/Nanopayments; not ERC-8183 workflow escrow | No public workflow DAG budget | Wallet policy controls only | Wallet/payment history, not a workflow receipt | AgentSaga consumes wallet/payment rails but owns workflow settlement semantics. |
| Circle Agent Marketplace | https://www.circle.com/agent-stack | Multichain; available | Agent Wallet identity | Service directory; no public protocol bidding | Pay-per-service | No | No | Payment records only | Discovery source, not a workflow coordinator. |
| Circle Agent Wallets | https://developers.circle.com/agent-stack | Multichain; available | Policy-controlled wallet | No | Transfers and contract execution | Per-wallet limits, not DAG budgets | Pause/limits, no compensation | Wallet transaction history | Optional operator/agent signer; never the source of workflow completion truth. |
| Circle Nanopayments | https://developers.circle.com/gateway/nanopayments | Supported testnets/mainnets; available | EOA signer | No | x402 EIP-3009 batched payment | Per-request spend only | No | Payment authorization/settlement evidence | Used by a node; payment success is evidence, not workflow success. |
| Circle CLI | https://developers.circle.com/agent-stack/circle-cli | Multichain; available | Agent/local wallets | Service discovery | Transfers, x402, contract calls | Command orchestration only | No | CLI output and chain records | Operator interface, not an onchain workflow protocol. |

## Product landscape

| Project | URL | Chain / public status | Identity | Marketplace / bidding | Escrow / evaluator | DAG / workflow budget | Compensation / rollback | Workflow receipt | Key overlap and exact differentiation |
|---|---|---|---|---|---|---|---|---|---|
| RSoft Agentic Bank | https://rsoft-agentic-bank.com | Arc/Base-related hackathon product; public site | KYA/DID claims | No general marketplace | Lending and settlement flows | LangGraph multi-agent roles, not onchain DAG settlement | No public compensation protocol | Transaction explorer | Multi-agent finance overlap; focused on credit/lending rather than dependent job settlement. |
| Vyper agentic payments | https://community.arc.io/public/blogs/what-vypers-arc-testnet-work-opens-up-for-builders-of-agentic-financial-workflows-2026-06-26 | Arc Testnet; public builder work | ERC-8004 exploration | No | Escrow, subscriptions, split payments and limits | Workflow controls are primitives, not a published aggregate DAG protocol | No published Saga compensation receipt | Per-contract events | Useful payment controls; AgentSaga adds dependency failure semantics and aggregate receipts. |
| the402 | https://the402.ai | Base; live marketplace claims | ERC-8004 rollout | Catalog, requests and bidding | Per-service/job escrow, verification and disputes | Agents can chain services offchain; no public onchain shared DAG budget | Refund/dispute, no reverse dependency compensation plan | Job/payment records | Marketplace and trust layer; AgentSaga is not a marketplace and settles a bounded multi-job workflow. |
| EvalLayer | https://evallayer.ai | Base/Virtuals ACP; live API claims | Agent/provider reputation | Evaluator marketplace | ERC-8183 evaluator and quorum APIs | No workflow budget or DAG | No | Evaluation records | Optional evaluator adapter only; AgentSaga keeps evaluator selection bounded by workflow policy. |
| Arbitr | Public product evidence was not located under this exact name | Unknown / unverified | Unknown | Unknown | Possible evaluator overlap could not be verified | Unknown | Unknown | Unknown | No claims are made without a verifiable source; re-audit if an authoritative URL is supplied. |
| MeshLedger | https://meshledger.io | Base and Solana; beta/live site claims | Platform agent profiles | Agent/skill/job marketplace | Single-job escrow and AI judge | No workflow-level DAG budget | Refund/dispute only | Public job/dispute records | Marketplace and single-job clearing; no Arc workflow compensation ledger. |
| Agent Bazaar | https://www.agent-bazaar.com/marketplace | x402 marketplace; public beta | Platform profiles | Skill marketplace | Per-call payments | No onchain workflow budget | No | Per-call records | Service discovery and purchase, not workflow financial safety. |
| Mercatai | https://www.mercatai.eu | Stripe/SEPA; beta | AvatarBook claim | B2B tasks with bidding | Stripe authorization and human approval | No | Refunds through payment rail, no Saga | Audit trail | Offchain marketplace with bids; not an Arc settlement protocol. |
| AgenC | https://agenc.tech | Solana mainnet; public protocol | Onchain agent registry | Marketplace and task claims | Program escrow, moderation and review | Runtime documentation mentions DAGs, but not one onchain cross-job budget/receipt | Disputes, not a published reverse compensation reserve | Task records | Closest orchestration overlap, but different chain and no verified complete feature combination. |
| EMIT | https://www.emitprotocol.com | Base; public site | Agent policy context | No general job marketplace | Agent-to-agent settlement and escrow | Shared treasury limits, no job DAG receipt | Refund on failure; no explicit Saga action lifecycle | Treasury/payment history | Treasury and settlement layer with its own token; AgentSaga is USDC-only and workflow-scoped. |
| Nave | https://www.nave.finance | Solana/Ethereum/Base; phase-one product claims | Soulbound role agents | No service marketplace | Multisig treasury execution | Multi-agent governance/treasury policy, not job dependencies | Emergency halt, no compensation jobs | Treasury accounting | Governance/yield treasury product; excluded from AgentSaga scope. |
| Argus | https://argus-pay.com | Fiat rails plus Base/Polygon claims | Platform agent identities | No | Policy engine before payments | Agent spend governance, not job DAG settlement | Kill/quarantine, no compensation workflow | Audit trail | Payment authorization control plane; AgentSaga governs post-delivery settlement and failure propagation. |
| Canopy | https://www.trycanopy.ai | Base/Tempo; beta | Platform agent identities | No | Policy-bound smart wallet, x402/MPP | Fleet budgets, no onchain dependent job graph | Pause/deny only | Activity log | Treasury guardrails; optional integration, not workflow state truth. |
| Valta | https://www.valta.co | Closed beta; Base/x402 roadmap | Platform agent accounts | Agent hiring is roadmap | Wallet/policy and claimed smart escrow | Shared wallets and limits, no onchain DAG receipt | Freeze/refund support; no Saga compensation | Audit log | Financial OS for agents; AgentSaga is a protocol-level per-workflow vault and receipt. |
| AuctionAgents | No authoritative exact-match public URL located | Unknown / unverified | Unknown | Name suggests auction overlap only | Unknown | Unknown | Unknown | Unknown | No technical comparison is fabricated; re-audit on receipt of an authoritative source. |
| saga-agent | https://pypi.org/project/saga-agent/ | Offchain Python library; available | None | No | No onchain escrow | Tool execution groups and retries | Reverse-order compensating functions; calls this “rollback” in product language | JSON audit log | Strong Saga-pattern overlap offchain; AgentSaga makes compensation explicit, funded, and onchain-verifiable without claiming reversal. |
| ArcAgent | https://www.arcagent.xyz | Arc Testnet; public demo/site | Registry/reputation claims | Agent directory | Single task escrow | No workflow DAG budget | Refund only | Activity feed | Arc marketplace/single task system; AgentSaga intentionally omits marketplace features. |
| AgentFlow | https://www.agentflow.one | Arc Testnet; public app | Onchain reputation claim | Paid agents selected through chat | Per-step USDC settlement | Multi-agent run orchestration; no public evidence of the full onchain budget/compensation/receipt combination | No published compensation reserve | Step transactions | Multi-step UX overlap; AgentSaga’s differentiator is protocol-enforced workflow financial lifecycle. |

## Multi-agent DAG and Saga frameworks

LangGraph, Temporal, BullMQ, n8n, AutoGen, CrewAI and similar systems can model dependent
execution and retries. Traditional Saga implementations can invoke compensating functions in
reverse order. Those systems are useful orchestration layers, but their scheduler database is not
an Arc settlement source of truth, and their “rollback” terminology must not imply reversal of an
irreversible payment or external effect. AgentSaga uses an offchain idempotent scheduler only to
drive transitions that the onchain coordinator independently validates.

## Final differentiation

“AgentSaga is not a marketplace, wallet, evaluator, or single-job escrow. It coordinates the
financial lifecycle of multiple dependent agent jobs under one bounded workflow budget and
produces a verifiable workflow-level settlement and compensation receipt.”

## Sources

- Arc Agentic Economy: https://docs.arc.io/build/agentic-economy
- Arc contract addresses: https://docs.arc.io/arc/references/contract-addresses
- Arc sample applications: https://docs.arc.io/arc/references/sample-applications
- Circle Agent Stack: https://developers.circle.com/agent-stack
- Circle Nanopayments: https://developers.circle.com/gateway/nanopayments
- Circle CLI: https://developers.circle.com/agent-stack/circle-cli
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- ERC-8183: https://eips.ethereum.org/EIPS/eip-8183
- Product URLs are linked directly in the tables above.

