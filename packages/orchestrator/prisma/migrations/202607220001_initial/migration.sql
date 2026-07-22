CREATE TABLE "ChainCursor" ("id" TEXT PRIMARY KEY, "chainId" INTEGER NOT NULL, "nextBlock" BIGINT NOT NULL, "lastBlockHash" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "IndexedEvent" ("id" TEXT PRIMARY KEY, "chainId" INTEGER NOT NULL, "transactionHash" TEXT NOT NULL, "logIndex" INTEGER NOT NULL, "blockNumber" BIGINT NOT NULL, "blockHash" TEXT NOT NULL, "eventName" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "IndexedEvent_chainId_transactionHash_logIndex_key" ON "IndexedEvent"("chainId", "transactionHash", "logIndex");
CREATE INDEX "IndexedEvent_chainId_blockNumber_idx" ON "IndexedEvent"("chainId", "blockNumber");
CREATE TABLE "WorkerAction" ("id" TEXT PRIMARY KEY, "workflow" TEXT NOT NULL, "nodeId" INTEGER, "action" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "WorkerAction_idempotencyKey_key" ON "WorkerAction"("idempotencyKey");
CREATE INDEX "WorkerAction_workflow_status_idx" ON "WorkerAction"("workflow", "status");
CREATE TABLE "ExecutionRecord" ("id" TEXT PRIMARY KEY, "value" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
