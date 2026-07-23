ALTER TABLE "IndexedEvent"
  ADD COLUMN "projectionLeaseOwner" TEXT,
  ADD COLUMN "projectionLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "IndexedEvent_source_order_idx"
  ON "IndexedEvent"("sourceId", "blockNumber", "logIndex");

CREATE TABLE "QueueOutbox" (
  "id" TEXT PRIMARY KEY,
  "queue" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actionId" TEXT,
  "resumeSequence" INTEGER NOT NULL DEFAULT 0,
  "executionAttempt" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "QueueOutbox_actionId_resumeSequence_executionAttempt_key"
  ON "QueueOutbox"("actionId", "resumeSequence", "executionAttempt");
CREATE INDEX "QueueOutbox_status_leaseExpiresAt_createdAt_idx"
  ON "QueueOutbox"("status", "leaseExpiresAt", "createdAt");

CREATE TABLE "TransactionIntent" (
  "id" TEXT PRIMARY KEY,
  "logicalActionKey" TEXT NOT NULL,
  "workflowAddress" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "transactionHash" TEXT,
  "payload" JSONB NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "broadcastStartedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "TransactionIntent_logicalActionKey_key"
  ON "TransactionIntent"("logicalActionKey");
CREATE INDEX "TransactionIntent_status_updatedAt_idx"
  ON "TransactionIntent"("status", "updatedAt");
CREATE INDEX "TransactionIntent_workflowAddress_action_idx"
  ON "TransactionIntent"("workflowAddress", "action");
