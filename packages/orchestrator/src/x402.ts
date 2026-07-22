import Fastify, { type FastifyInstance } from "fastify";
import { hashJson } from "./hash.js";
import { ARC_TESTNET_USDC } from "@agentsaga/contracts";
import type { Address } from "viem";
import type { CircleAgentWalletAdapter } from "./circle-wallet.js";

export const LOCAL_X402_PRICE = 1_000n;

export interface LocalPaymentRequirement {
  scheme: "agentsaga-local-fixture";
  network: "local";
  amount: string;
  asset: "USDC-fixture";
  payTo: string;
  nonce: string;
}

export function createPaymentFixture(
  requirement: LocalPaymentRequirement,
  payer: string,
): string {
  return hashJson({ requirement, payer });
}

export function createLocalX402Service(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get<{ Querystring: { payer?: string } }>("/paid/vendor-lookup", async (request, reply) => {
    const payer = request.query.payer ?? "local-demo-agent";
    const requirement: LocalPaymentRequirement = {
      scheme: "agentsaga-local-fixture",
      network: "local",
      amount: LOCAL_X402_PRICE.toString(),
      asset: "USDC-fixture",
      payTo: "local-research-provider",
      nonce: "vendor-lookup-v1",
    };
    const supplied = request.headers["x-payment-fixture"];
    if (supplied !== createPaymentFixture(requirement, payer)) {
      return reply.code(402).send({
        paymentRequired: requirement,
        evidenceMode: "local-fixture-not-onchain",
      });
    }
    return reply.send({
      vendorId: "deterministic-vendor-fixture",
      sanctionsMatch: false,
      source: "local-reproducible-x402-service",
      paymentEvidence: createPaymentFixture(requirement, payer),
      evidenceMode: "local-fixture-not-onchain",
    });
  });
  return app;
}

export async function buyLocalX402Resource(
  url: URL,
  payer: string,
  maximumCost: bigint,
): Promise<{ data: unknown; cost: bigint; fixture: string }> {
  url.searchParams.set("payer", payer);
  const initial = await fetch(url);
  if (initial.status !== 402) throw new Error(`Expected HTTP 402, received ${initial.status}`);
  const body = (await initial.json()) as { paymentRequired: LocalPaymentRequirement };
  const cost = BigInt(body.paymentRequired.amount);
  if (cost > maximumCost) throw new Error("x402 requirement exceeds node budget");
  const fixture = createPaymentFixture(body.paymentRequired, payer);
  const paid = await fetch(url, { headers: { "x-payment-fixture": fixture } });
  if (!paid.ok) throw new Error(`Local x402 fixture rejected with HTTP ${paid.status}`);
  return { data: await paid.json(), cost, fixture };
}

export interface RealX402Evidence {
  mode: "real-x402-circle-cli";
  requirementHash: `0x${string}`;
  responseHash: `0x${string}`;
  paymentResult: unknown;
}

/** Validates a live 402 requirement before delegating payment/retry to Circle's official CLI. */
export async function buyCircleX402Resource(input: {
  url: URL; wallet: CircleAgentWalletAdapter; maximumMicroUsdc: bigint; expectedRecipient: Address;
}): Promise<RealX402Evidence> {
  const initial = await fetch(input.url, { redirect: "error" });
  if (initial.status !== 402) throw new Error(`Expected HTTP 402, received ${initial.status}`);
  const encoded = initial.headers.get("payment-required");
  const body = await initial.clone().json().catch(() => undefined) as Record<string, unknown> | undefined;
  const requirement = encoded ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown> : body?.paymentRequired as Record<string, unknown> | undefined;
  if (!requirement) throw new Error("Missing x402 payment requirement");
  const network = String(requirement.network ?? requirement.chainId ?? "");
  const asset = String(requirement.asset ?? "").toLowerCase();
  const amount = BigInt(String(requirement.amount ?? requirement.maxAmountRequired ?? "-1"));
  const recipient = String(requirement.payTo ?? requirement.recipient ?? "").toLowerCase();
  const deadline = requirement.deadline === undefined ? undefined : Number(requirement.deadline);
  if (network !== "eip155:5042002" && network !== "5042002" && network !== "ARC-TESTNET") throw new Error("x402 network is not Arc Testnet");
  if (asset !== ARC_TESTNET_USDC.toLowerCase()) throw new Error("x402 asset is not official Arc Testnet USDC");
  if (amount < 0n || amount > input.maximumMicroUsdc) throw new Error("x402 amount exceeds node budget");
  if (recipient !== input.expectedRecipient.toLowerCase()) throw new Error("x402 recipient mismatch");
  if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1_000))) throw new Error("x402 requirement is expired");
  const paymentResult = await input.wallet.payX402(input.url, input.maximumMicroUsdc);
  return { mode: "real-x402-circle-cli", requirementHash: hashJson(requirement), responseHash: hashJson(paymentResult), paymentResult };
}
