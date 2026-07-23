import { PrismaClient, Prisma, type WorkerAction } from "@prisma/client";
import type { AgentJobResult } from "./types.js";
import type { ExecutionStore } from "./engine.js";
import type { BlockCursor, CursorStore, DecodedIndexedEvent } from "./indexer.js";
import type { Log } from "viem";

export const prisma = new PrismaClient();

export class PostgresExecutionStore implements ExecutionStore {
  constructor(private readonly db: PrismaClient = prisma) {}
  async get(key: string) { return (await this.db.executionRecord.findUnique({ where: { id: key } }))?.value as unknown as AgentJobResult | undefined; }
  async putIfAbsent(key: string, value: AgentJobResult) {
    const record = await this.db.executionRecord.upsert({ where: { id: key }, create: { id: key, value: value as unknown as Prisma.InputJsonValue }, update: {} });
    return record.value as unknown as AgentJobResult;
  }
}

export class PostgresCursorStore implements CursorStore {
  constructor(private readonly chainId: number, private readonly db: PrismaClient = prisma) {}
  async load(id: string): Promise<BlockCursor | undefined> {
    const row = await this.db.chainCursor.findUnique({ where: { id } });
    if (!row) return undefined;
    return {
      nextBlock: row.nextBlock,
      ...(row.nextBlock > 0n ? { lastProcessedBlock: row.nextBlock - 1n } : {}),
      ...(row.lastBlockHash ? { lastProcessedHash: row.lastBlockHash as `0x${string}` } : {}),
    };
  }
  async save(id: string, cursor: BlockCursor) {
    await this.db.chainCursor.upsert({ where: { id }, create: { id, chainId: this.chainId, nextBlock: cursor.nextBlock, lastBlockHash: cursor.lastProcessedHash ?? null }, update: { nextBlock: cursor.nextBlock, lastBlockHash: cursor.lastProcessedHash ?? null } });
  }
  async putLogIfAbsent(id: string, log: Log, decoded?: DecodedIndexedEvent) {
    if (!log.transactionHash || log.logIndex === null || !log.blockNumber || !log.blockHash) return false;
    try {
      await this.db.indexedEvent.create({ data: {
        id: `${id}:${log.transactionHash}:${log.logIndex}`,
        sourceId: id,
        chainId: this.chainId,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        eventName: decoded?.eventName ?? "unrecognized",
        payload: jsonValue({
          decoded: decoded ?? null,
          raw: {
            address: log.address.toLowerCase(),
            topics: [...log.topics],
            data: log.data,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
            blockHash: log.blockHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            removed: log.removed,
          },
        }),
      } });
      return true;
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false; throw error; }
  }
  async loadPendingLogs(id: string, limit = 100): Promise<Array<{ id: string; log: Log }>> {
    const rows = await this.db.indexedEvent.findMany({
      where: {
        sourceId: id,
        projectionStatus: { in: ["received", "failed"] },
        OR: [{ nextProjectionAttemptAt: null }, { nextProjectionAttemptAt: { lte: new Date() } }],
      },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: limit,
    });
    return rows.map((row) => {
      const payload = row.payload as { raw: Record<string, unknown> };
      const raw = payload.raw;
      return {
        id: row.id,
        log: {
          address: String(raw.address) as `0x${string}`,
          topics: (raw.topics as `0x${string}`[]) ?? [],
          data: String(raw.data) as `0x${string}`,
          transactionHash: row.transactionHash as `0x${string}`,
          transactionIndex: raw.transactionIndex === null || raw.transactionIndex === undefined ? null : Number(raw.transactionIndex),
          blockHash: row.blockHash as `0x${string}`,
          blockNumber: row.blockNumber,
          logIndex: row.logIndex,
          removed: Boolean(raw.removed),
        } as Log,
      };
    });
  }
  async claimProjection(eventId: string): Promise<boolean> {
    const result = await this.db.indexedEvent.updateMany({
      where: {
        id: eventId,
        projectionStatus: { in: ["received", "failed"] },
        OR: [{ nextProjectionAttemptAt: null }, { nextProjectionAttemptAt: { lte: new Date() } }],
      },
      data: { projectionStatus: "processing", processingStartedAt: new Date() },
    });
    return result.count === 1;
  }
  async markProjectionProcessed(eventId: string): Promise<void> {
    await this.db.indexedEvent.update({
      where: { id: eventId },
      data: {
        projectionStatus: "processed",
        processedAt: new Date(),
        processingStartedAt: null,
        nextProjectionAttemptAt: null,
        lastProjectionError: null,
      },
    });
  }
  async markProjectionFailed(eventId: string, error: string): Promise<void> {
    const current = await this.db.indexedEvent.findUniqueOrThrow({ where: { id: eventId }, select: { projectionAttempts: true } });
    const attempts = current.projectionAttempts + 1;
    await this.db.indexedEvent.update({
      where: { id: eventId },
      data: {
        projectionStatus: "failed",
        projectionAttempts: attempts,
        lastProjectionError: error.slice(0, 2_000),
        processingStartedAt: null,
        nextProjectionAttemptAt: new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8))),
      },
    });
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
}

export class PostgresActionLedger {
  constructor(private readonly db: PrismaClient = prisma) {}
  async reserve(input: { id: string; workflow: string; nodeId?: number; action: string; idempotencyKey: string; payload: Prisma.InputJsonValue }): Promise<WorkerAction> {
    return this.db.workerAction.upsert({ where: { idempotencyKey: input.idempotencyKey }, create: { ...input, status: "reserved" }, update: {} });
  }
  async complete(idempotencyKey: string) { return this.db.workerAction.update({ where: { idempotencyKey }, data: { status: "completed" } }); }
  async fail(idempotencyKey: string, error: string) { return this.db.workerAction.update({ where: { idempotencyKey }, data: { status: "failed", attempts: { increment: 1 }, lastError: error.slice(0, 2_000) } }); }
}
