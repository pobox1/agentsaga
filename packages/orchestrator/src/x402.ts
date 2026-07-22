import Fastify, { type FastifyInstance } from "fastify";
import { hashJson } from "./hash.js";

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

