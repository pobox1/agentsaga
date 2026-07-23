import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { bootstrapSigners } from "./signer-bootstrap.js";
import { SignerRegistry } from "./signer-registry.js";
import type { TransactionSigner } from "./transaction-signer.js";

const workflow = "0x1111111111111111111111111111111111111111";
const signerAddress = "0x2222222222222222222222222222222222222222";

describe("production signer bootstrap", () => {
  it("loads explicit role-separated manual signers in hybrid mode", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      OPERATION_MODE: "hybrid",
      SIGNER_CONFIG_JSON: JSON.stringify({ version: 1, signers: [
        { backend: "manual", workflow, role: "provider", address: signerAddress, expectedAddress: signerAddress },
        { backend: "manual", workflow, role: "evaluator", address: "0x3333333333333333333333333333333333333333" },
      ] }),
    });
    const { registry, result } = await bootstrapSigners({ config });
    expect(result).toMatchObject({ configured: 2, ready: 0 });
    const facts = await registry.facts();
    expect(facts.provider).toMatchObject({ configured: true, status: "manual" });
    expect(facts.evaluator.scopedEntries).toBe(1);
  });

  it("rejects a configured wrong address", async () => {
    const config = loadConfig({ NODE_ENV: "test", SIGNER_CONFIG_JSON: JSON.stringify({ version: 1, signers: [
      { backend: "manual", workflow, role: "provider", address: signerAddress, expectedAddress: "0x4444444444444444444444444444444444444444" },
    ] }) });
    await expect(bootstrapSigners({ config })).rejects.toThrow(/does not match/);
  });

  it("fails encrypted loading without the separately supplied passphrase", async () => {
    const encrypted = encrypt("0x" + "11".repeat(32), "correct horse");
    const config = loadConfig({ NODE_ENV: "test", SIGNER_CONFIG_JSON: JSON.stringify({ version: 1, signers: [
      { backend: "encrypted-local", workflow, role: "provider", expectedAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", envelope: encrypted, passphraseEnv: "TEST_SIGNER_PASSPHRASE" },
    ] }) });
    await expect(bootstrapSigners({ config, environment: {} })).rejects.toThrow(/Secret manager did not supply/);
    const loaded = await bootstrapSigners({ config, environment: { TEST_SIGNER_PASSPHRASE: "correct horse" } });
    expect(loaded.result.ready).toBe(1);
  });

  it("keeps Circle external authentication factual and blocks incomplete autonomous startup", async () => {
    const circleConfig = loadConfig({ NODE_ENV: "test", OPERATION_MODE: "hybrid", SIGNER_CONFIG_JSON: JSON.stringify({ version: 1, signers: [
      { backend: "circle", workflow, role: "circle-agent-wallet", expectedAddress: signerAddress },
    ] }) });
    expect((await bootstrapSigners({ config: circleConfig })).result.waitingExternalAuth).toBe(1);
    const autonomous = loadConfig({ NODE_ENV: "test", OPERATION_MODE: "autonomous" });
    await expect(bootstrapSigners({ config: autonomous })).rejects.toThrow(/no workflow-scoped signer configuration/);
  });

  it("measures signer coverage by workflow and node scope instead of role totals", async () => {
    const registry = new SignerRegistry();
    const readySigner: TransactionSigner = {
      address: async () => signerAddress,
      status: async () => "ready",
      sendContractTransaction: async () => { throw new Error("not used"); },
    };
    await registry.register({ workflow, role: "provider" }, readySigner);
    const secondWorkflow = "0x5555555555555555555555555555555555555555";
    const coverage = await registry.coverage([
      { workflow, nodeId: 3, role: "provider" },
      { workflow: secondWorkflow, nodeId: 3, role: "provider" },
    ]);
    expect(coverage).toMatchObject({ required: 2, covered: 1 });
    expect(coverage.missing).toEqual([{ workflow: secondWorkflow, nodeId: 3, role: "provider" }]);
  });
});

function encrypt(privateKey: string, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
