import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { buyLocalX402Resource, createLocalX402Service } from "./x402.js";

const apps: ReturnType<typeof createLocalX402Service>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local x402 fixture", () => {
  it("performs a reproducible 402 -> fixture payment -> resource flow", async () => {
    const app = createLocalX402Service();
    apps.push(app);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const result = await buyLocalX402Resource(
      new URL("/paid/vendor-lookup", address),
      "research-agent",
      2_000n,
    );
    expect(result.cost).toBe(1_000n);
    expect(result.fixture).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.data).toMatchObject({
      source: "local-reproducible-x402-service",
      evidenceMode: "local-fixture-not-onchain",
    });
  });

  it("does not pay when the requirement exceeds the node budget", async () => {
    const app = createLocalX402Service();
    apps.push(app);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    await expect(
      buyLocalX402Resource(
        new URL("/paid/vendor-lookup", address),
        "research-agent",
        999n,
      ),
    ).rejects.toThrow("exceeds node budget");
  });
});

