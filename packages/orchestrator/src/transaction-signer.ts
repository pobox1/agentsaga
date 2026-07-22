import { createDecipheriv, scryptSync } from "node:crypto";
import { createWalletClient, encodeFunctionData, http, type Abi, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@agentsaga/contracts";

export type SignerStatus = "ready" | "manual" | "disabled" | "blocked_external_auth";
export type ContractWriteRequest = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
export interface TransactionSigner {
  address(): Promise<Address>;
  sendContractTransaction(request: ContractWriteRequest): Promise<Hash>;
  status(): Promise<SignerStatus>;
}

export class DisabledSigner implements TransactionSigner {
  constructor(private readonly reason = "Signer is disabled") {}
  async address(): Promise<Address> { throw new Error(this.reason); }
  async sendContractTransaction(): Promise<Hash> { throw new Error(this.reason); }
  async status(): Promise<SignerStatus> { return "disabled"; }
}

export class ManualOperatorSigner implements TransactionSigner {
  constructor(private readonly operator: Address) {}
  async address(): Promise<Address> { return this.operator; }
  async sendContractTransaction(): Promise<Hash> { throw new Error("Manual operator signature is required"); }
  async status(): Promise<SignerStatus> { return "manual"; }
}

export class LocalEncryptedTestSigner implements TransactionSigner {
  private constructor(private readonly privateKey: Hex, private readonly rpcUrl: string) {}
  static fromEnvironment(encrypted: string, passphrase: string, rpcUrl: string): LocalEncryptedTestSigner {
    const envelope = JSON.parse(encrypted) as { salt: string; iv: string; tag: string; ciphertext: string };
    const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const privateKey = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8") as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Encrypted signer payload is invalid");
    return new LocalEncryptedTestSigner(privateKey, rpcUrl);
  }
  async address(): Promise<Address> { return privateKeyToAccount(this.privateKey).address; }
  async status(): Promise<SignerStatus> { return "ready"; }
  async sendContractTransaction(request: ContractWriteRequest): Promise<Hash> {
    const account = privateKeyToAccount(this.privateKey);
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(this.rpcUrl) });
    const data = encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args });
    return wallet.sendTransaction({ account, chain: arcTestnet, to: request.address, data, ...(request.value === undefined ? {} : { value: request.value }) });
  }
}

export class CircleAgentWalletSigner implements TransactionSigner {
  constructor(private readonly walletAddress: Address | undefined, private readonly executor?: (request: ContractWriteRequest) => Promise<Hash>) {}
  async address(): Promise<Address> { if (!this.walletAddress) throw new Error("Circle Agent Wallet is not authenticated"); return this.walletAddress; }
  async status(): Promise<SignerStatus> { return this.walletAddress && this.executor ? "ready" : "blocked_external_auth"; }
  async sendContractTransaction(request: ContractWriteRequest): Promise<Hash> { if (!this.executor) throw new Error("Circle Agent Wallet operator authentication is required"); return this.executor(request); }
}
