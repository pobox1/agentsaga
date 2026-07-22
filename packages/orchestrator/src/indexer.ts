import {
  createPublicClient,
  decodeEventLog,
  http,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
} from "viem";
import { arcTestnet, receiptRegistryAbi, workflowCoordinatorAbi, workflowFactoryAbi } from "@agentsaga/contracts";

export const trackedEventNames = ["WorkflowCreated", "WorkflowFunded", "WorkflowStatusChanged", "NodeReady", "NodeApproved", "NodeActivated", "NodeSubmitted", "NodeCompleted", "NodeRejected", "NodeSkipped", "CompensationPlanned", "CompensationJobOpened", "CompensationCompleted", "CompensationUnresolved", "Refunded", "WorkflowReceiptFinalized"] as const;
const trackedNames = new Set<string>(trackedEventNames);
const trackedEventAbi = [...workflowFactoryAbi, ...workflowCoordinatorAbi, ...receiptRegistryAbi] as const;

export interface DecodedIndexedEvent { eventName: string; payload: Record<string, unknown> }

export interface BlockCursor {
  nextBlock: bigint;
  lastProcessedBlock?: bigint;
  lastProcessedHash?: Hash;
}

export interface CursorStore {
  load(id: string): Promise<BlockCursor | undefined>;
  save(id: string, cursor: BlockCursor): Promise<void>;
  putLogIfAbsent(id: string, log: Log, decoded?: DecodedIndexedEvent): Promise<boolean>;
}

export class InMemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, BlockCursor>();
  private readonly logs = new Set<string>();

  async load(id: string): Promise<BlockCursor | undefined> {
    return this.cursors.get(id);
  }

  async save(id: string, cursor: BlockCursor): Promise<void> {
    this.cursors.set(id, cursor);
  }

  async putLogIfAbsent(id: string, log: Log, _decoded?: DecodedIndexedEvent): Promise<boolean> {
    const key = `${id}:${log.transactionHash ?? "pending"}:${log.logIndex ?? -1}`;
    if (this.logs.has(key)) return false;
    this.logs.add(key);
    return true;
  }
}

export interface ArcIndexerOptions {
  id: string;
  addresses: Address[];
  startBlock: bigint;
  blockRange?: bigint;
  rpcUrl?: string;
}

export class ArcEventIndexer {
  private readonly client: PublicClient;
  private readonly blockRange: bigint;

  constructor(
    private readonly options: ArcIndexerOptions,
    private readonly store: CursorStore,
    private readonly onLog: (log: Log) => Promise<void>,
  ) {
    this.client = createPublicClient({
      chain: arcTestnet,
      transport: http(options.rpcUrl ?? arcTestnet.rpcUrls.default.http[0]),
    });
    this.blockRange = options.blockRange ?? 2_000n;
  }

  async syncOnce(): Promise<number> {
    let cursor = (await this.store.load(this.options.id)) ?? {
      nextBlock: this.options.startBlock,
    };
    if (cursor.lastProcessedBlock !== undefined && cursor.lastProcessedHash !== undefined) {
      const block = await this.client.getBlock({ blockNumber: cursor.lastProcessedBlock });
      if (block.hash !== cursor.lastProcessedHash) {
        cursor = { nextBlock: cursor.lastProcessedBlock };
      }
    }

    const latest = await this.client.getBlockNumber();
    if (cursor.nextBlock > latest) return 0;
    const toBlock = cursor.nextBlock + this.blockRange - 1n > latest
      ? latest
      : cursor.nextBlock + this.blockRange - 1n;
    const logs = await this.client.getLogs({
      address: this.options.addresses,
      fromBlock: cursor.nextBlock,
      toBlock,
    });
    let inserted = 0;
    for (const log of logs) {
      const decoded = decodeTrackedEvent(log);
      if (!(await this.store.putLogIfAbsent(this.options.id, log, decoded))) continue;
      await this.onLog(log);
      inserted += 1;
    }
    const block = await this.client.getBlock({ blockNumber: toBlock });
    await this.store.save(this.options.id, {
      nextBlock: toBlock + 1n,
      lastProcessedBlock: toBlock,
      lastProcessedHash: block.hash,
    });
    return inserted;
  }
}

export function decodeTrackedEvent(log: Log): DecodedIndexedEvent | undefined {
  try {
    const decoded = decodeEventLog({ abi: trackedEventAbi, data: log.data, topics: log.topics, strict: false });
    if (!trackedNames.has(decoded.eventName)) return undefined;
    return { eventName: decoded.eventName, payload: jsonSafe({ address: log.address.toLowerCase(), args: decoded.args }) };
  } catch { return undefined; }
}

function jsonSafe(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Record<string, unknown>;
}
