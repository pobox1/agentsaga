import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAddress, isAddress, type Address } from "viem";

const execFileAsync = promisify(execFile);
const CHAIN = "ARC-TESTNET";

export interface WorkflowSpendingPolicy {
  workflow: Address;
  maximumMicroUsdc: bigint;
  recipients: readonly Address[];
  contracts: readonly Address[];
}

/** Backend-only wrapper around Circle's official Agent Wallet CLI. It never accepts OTPs. */
export class CircleAgentWalletAdapter {
  constructor(private readonly wallet: Address, private readonly policy: WorkflowSpendingPolicy, private readonly binary = "circle") {
    if (!isAddress(wallet)) throw new Error("Invalid Circle wallet address");
  }
  private async run(args: string[]) {
    const { stdout } = await execFileAsync(this.binary, [...args, "--output", "json"], { windowsHide: true, timeout: 120_000, maxBuffer: 1_048_576, env: process.env });
    return JSON.parse(stdout) as unknown;
  }
  sessionStatus() { return this.run(["wallet", "status", "--type", "agent"]); }
  wallets() { return this.run(["wallet", "list", "--type", "agent", "--chain", CHAIN]); }
  balance() { return this.run(["wallet", "balance", "--address", this.wallet, "--chain", CHAIN]); }
  async transfer(recipient: Address, microUsdc: bigint) {
    this.enforce(recipient, microUsdc, "recipient");
    return this.run(["wallet", "transfer", recipient, "--amount", formatMicroUsdc(microUsdc), "--address", this.wallet, "--chain", CHAIN]);
  }
  async execute(contract: Address, signature: string, parameters: readonly string[], microUsdc = 0n) {
    this.enforce(contract, microUsdc, "contract");
    return this.run(["wallet", "execute", signature, ...parameters, "--contract", contract, "--address", this.wallet, "--chain", CHAIN]);
  }
  signTypedData(typedData: unknown) {
    return this.run(["wallet", "sign", "typed-data", JSON.stringify(typedData), "--address", this.wallet, "--chain", CHAIN]);
  }
  payX402(url: URL, maximumMicroUsdc: bigint) {
    if (maximumMicroUsdc > this.policy.maximumMicroUsdc) throw new Error("x402 maximum exceeds workflow policy");
    return this.run(["services", "pay", url.toString(), "--address", this.wallet, "--chain", CHAIN, "--max-amount", formatMicroUsdc(maximumMicroUsdc)]);
  }
  private enforce(target: Address, amount: bigint, kind: "recipient" | "contract") {
    if (amount < 0n || amount > this.policy.maximumMicroUsdc) throw new Error("Workflow spending limit exceeded");
    const allowed = kind === "recipient" ? this.policy.recipients : this.policy.contracts;
    if (!allowed.map(getAddress).includes(getAddress(target))) throw new Error(`${kind} is not allowlisted`);
  }
}

function formatMicroUsdc(value: bigint) {
  const whole = value / 1_000_000n; const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
