import {
  createPublicClient,
  decodeEventLog,
  http,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
} from "viem";
import { agentJobAdapterAbi, arcTestnet, receiptRegistryAbi, workflowCoordinatorAbi, workflowFactoryAbi, workflowStatusLabels } from "@agentsaga/contracts";

export const trackedEventNames = ["WorkflowCreated", "WorkflowFunded", "WorkflowStatusChanged", "NodeReady", "NodeApproved", "NodeActivated", "NodeSubmitted", "NodeCompleted", "NodeRejected", "NodeSkipped", "CompensationPlanned", "CompensationJobOpened", "CompensationCompleted", "CompensationUnresolved", "Refunded", "JobCreated", "JobFunded", "JobSubmitted", "JobCompleted", "JobRejected", "JobExpired", "WorkflowReceiptFinalized"] as const;
const trackedNames = new Set<string>(trackedEventNames);
const trackedEventAbi = [...workflowFactoryAbi, ...workflowCoordinatorAbi, ...agentJobAdapterAbi, ...receiptRegistryAbi] as const;

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
  loadPendingLogs(id: string, limit?: number): Promise<Array<{ id: string; log: Log }>>;
  claimProjection(eventId: string): Promise<boolean>;
  markProjectionProcessed(eventId: string): Promise<void>;
  markProjectionFailed(eventId: string, error: string): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, BlockCursor>();
  private readonly logs = new Map<string, { sourceId: string; log: Log; status: "received" | "processing" | "processed" | "failed"; nextAttemptAt?: number; attempts: number }>();

  async load(id: string): Promise<BlockCursor | undefined> {
    return this.cursors.get(id);
  }

  async save(id: string, cursor: BlockCursor): Promise<void> {
    this.cursors.set(id, cursor);
  }

  async putLogIfAbsent(id: string, log: Log, _decoded?: DecodedIndexedEvent): Promise<boolean> {
    const key = `${id}:${log.transactionHash ?? "pending"}:${log.logIndex ?? -1}`;
    if (this.logs.has(key)) return false;
    this.logs.set(key, { sourceId: id, log, status: "received", attempts: 0 });
    return true;
  }
  async loadPendingLogs(id: string, limit = 100): Promise<Array<{ id: string; log: Log }>> {
    const now = Date.now();
    return [...this.logs.entries()]
      .filter(([, value]) => value.sourceId === id && (value.status === "received" || value.status === "failed") && (value.nextAttemptAt ?? 0) <= now)
      .slice(0, limit)
      .map(([eventId, value]) => ({ id: eventId, log: value.log }));
  }
  async claimProjection(eventId: string): Promise<boolean> {
    const item = this.logs.get(eventId);
    if (!item || !["received", "failed"].includes(item.status)) return false;
    item.status = "processing";
    return true;
  }
  async markProjectionProcessed(eventId: string): Promise<void> {
    const item = this.logs.get(eventId); if (item) item.status = "processed";
  }
  async markProjectionFailed(eventId: string): Promise<void> {
    const item = this.logs.get(eventId);
    if (item) {
      item.status = "failed";
      item.attempts++;
      item.nextAttemptAt = Date.now();
    }
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

    let projected = await projectPendingEvents(this.store, this.options.id, this.onLog);
    const latest = await this.client.getBlockNumber();
    if (cursor.nextBlock > latest) return projected;
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
      if (await this.store.putLogIfAbsent(this.options.id, log, decoded)) inserted += 1;
    }
    const block = await this.client.getBlock({ blockNumber: toBlock });
    await this.store.save(this.options.id, {
      nextBlock: toBlock + 1n,
      lastProcessedBlock: toBlock,
      lastProcessedHash: block.hash,
    });
    projected += await projectPendingEvents(this.store, this.options.id, this.onLog);
    return projected;
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

export async function projectPendingEvents(
  store: CursorStore,
  sourceId: string,
  onLog: (log: Log) => Promise<void>,
): Promise<number> {
  const pending = await store.loadPendingLogs(sourceId);
  let processed = 0;
  for (const event of pending) {
    if (!(await store.claimProjection(event.id))) continue;
    try {
      await onLog(event.log);
      await store.markProjectionProcessed(event.id);
      processed++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : "unknown projection error").slice(0, 2_000);
      await store.markProjectionFailed(event.id, message);
    }
  }
  return processed;
}

export function workflowStatusUpdate(eventName: string, current: unknown): { status: string; statusCode: number; statusLabel: string } | undefined {
  if (eventName !== "WorkflowStatusChanged") return undefined;
  const statusCode = Number(current); const statusLabel = workflowStatusLabels[statusCode] ?? `Unknown(${statusCode})`;
  return { status: statusLabel, statusCode, statusLabel };
}

export function appendTransactionEvent(existing: unknown, event: { eventName: string; logIndex: number | null; emitter: string }) {
  const events = typeof existing === "object" && existing !== null && "events" in existing && Array.isArray((existing as { events?: unknown }).events) ? (existing as { events: unknown[] }).events : [];
  const duplicate = events.some((item) => typeof item === "object" && item !== null
    && "logIndex" in item && item.logIndex === event.logIndex
    && "emitter" in item && item.emitter === event.emitter);
  return { events: duplicate ? events : [...events, event] };
}

export function workflowJobType(eventName: string): "service" | "compensation" { return eventName === "CompensationJobOpened" ? "compensation" : "service"; }
