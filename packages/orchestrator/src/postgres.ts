import { PrismaClient, Prisma, type WorkerAction } from "@prisma/client";
import type { AgentJobResult } from "./types.js";
import type { ExecutionStore } from "./engine.js";
import type { BlockCursor, CursorStore } from "./indexer.js";
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
  async putLogIfAbsent(id: string, log: Log) {
    if (!log.transactionHash || log.logIndex === null || !log.blockNumber || !log.blockHash) return false;
    try {
      await this.db.indexedEvent.create({ data: { id: `${id}:${log.transactionHash}:${log.logIndex}`, chainId: this.chainId, transactionHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber, blockHash: log.blockHash, eventName: "unknown", payload: { address: log.address, topics: [...log.topics], data: log.data } } });
      return true;
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false; throw error; }
  }
}

export class PostgresActionLedger {
  constructor(private readonly db: PrismaClient = prisma) {}
  async reserve(input: { id: string; workflow: string; nodeId?: number; action: string; idempotencyKey: string; payload: Prisma.InputJsonValue }): Promise<WorkerAction> {
    return this.db.workerAction.upsert({ where: { idempotencyKey: input.idempotencyKey }, create: { ...input, status: "reserved" }, update: {} });
  }
  async complete(idempotencyKey: string) { return this.db.workerAction.update({ where: { idempotencyKey }, data: { status: "completed" } }); }
  async fail(idempotencyKey: string, error: string) { return this.db.workerAction.update({ where: { idempotencyKey }, data: { status: "failed", attempts: { increment: 1 }, lastError: error.slice(0, 2_000) } }); }
}
