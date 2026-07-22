# Security best-practices review

## Executive summary

The deployment-readiness changes introduce no confirmed critical or high-severity TypeScript/Next.js security defect. The API now returns sanitized production errors and applies baseline anti-sniffing, framing, referrer, and permissions headers. Database access uses Prisma or parameterized SQL, Circle CLI execution uses `execFile` with an argument array, and CI retains Slither, Gitleaks, dependency-audit, ABI-drift, and contract test gates.

Two production hardening items remain. They are operator gates rather than evidence that the currently undeployed system is compromised.

## Critical

None confirmed.

## High

None confirmed.

## Medium

None confirmed.

## Low / operational hardening

### SEC-001 — Restrict production outbound adapter destinations

The HTTP, MCP, model, evaluator, and real x402 adapters initiate outbound requests to configured URLs (`packages/orchestrator/src/agents.ts:59`, `packages/orchestrator/src/agents.ts:79`, `packages/orchestrator/src/agents.ts:112`, `packages/orchestrator/src/evaluators.ts:57`, and `packages/orchestrator/src/x402.ts:83`). Before exposing configuration to untrusted tenants, production must apply an explicit HTTPS hostname allowlist, reject loopback/private/link-local targets after DNS resolution, cap response size and duration, and route egress through a controlled proxy. Current operation assumes trusted operator-owned configuration.

### SEC-002 — Add a deployment-specific Content Security Policy

The web application supplies baseline browser security headers in `apps/web/next.config.ts:6`, but intentionally has no Content Security Policy yet. Add a nonce-based CSP after the exact wallet/RPC/analytics origins are known. A guessed policy at this stage could either break wallet integrations or require unsafe exceptions that provide little protection.

## Verified secure patterns

- `packages/orchestrator/src/server.ts:30` sanitizes unexpected production errors instead of returning stack traces or internal exception text.
- `packages/orchestrator/src/server.ts:37` applies baseline API response security headers.
- `packages/orchestrator/src/circle-wallet.ts:21` invokes the Circle CLI through `execFile` with an argument array, a timeout, and a bounded output buffer; it does not interpolate a shell command.
- Transaction writes re-read chain state, resolve role-specific signers, simulate calls, and persist transaction identity before receipt verification.
- No dynamic `eval`, `new Function`, or direct DOM HTML injection sink was found in the reviewed TypeScript/TSX source.

## Tooling status

Slither and Gitleaks remain mandatory GitHub Actions gates. Local executable availability and final remote results are reported separately; a missing local binary is not represented as a successful local scan.
