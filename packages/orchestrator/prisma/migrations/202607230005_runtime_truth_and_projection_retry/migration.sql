ALTER TABLE "IndexedEvent"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "projectionStatus" TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN "projectionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastProjectionError" TEXT,
  ADD COLUMN "nextProjectionAttemptAt" TIMESTAMP(3),
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processedAt" TIMESTAMP(3);

UPDATE "IndexedEvent"
SET "sourceId" = split_part("id", ':0x', 1),
    "projectionStatus" = 'processed',
    "processedAt" = "createdAt";

ALTER TABLE "IndexedEvent" ALTER COLUMN "sourceId" SET NOT NULL;

CREATE INDEX "IndexedEvent_sourceId_projectionStatus_nextProjectionAttemptAt_idx"
  ON "IndexedEvent"("sourceId", "projectionStatus", "nextProjectionAttemptAt");
CREATE INDEX "IndexedEvent_projectionStatus_nextProjectionAttemptAt_idx"
  ON "IndexedEvent"("projectionStatus", "nextProjectionAttemptAt");

ALTER TABLE "WorkflowJob"
  ADD COLUMN "budget" TEXT,
  ADD COLUMN "expiry" TIMESTAMP(3),
  ADD COLUMN "specificationHash" TEXT;

ALTER TABLE "ProcessorCapability"
  ADD COLUMN "configuredStatus" TEXT,
  ADD COLUMN "dependencyStatus" TEXT,
  ADD COLUMN "signerAvailability" TEXT,
  ADD COLUMN "signerRole" TEXT,
  ADD COLUMN "adapterAvailability" TEXT,
  ADD COLUMN "operational" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "configVersion" TEXT,
  ADD COLUMN "configHash" TEXT;

ALTER TABLE "AgentExecution"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "executionType" TEXT;

UPDATE "AgentExecution"
SET "jobId" = 'legacy:' || "id",
    "executionType" = 'service';

ALTER TABLE "AgentExecution"
  ALTER COLUMN "jobId" SET NOT NULL,
  ALTER COLUMN "executionType" SET NOT NULL;

DROP INDEX IF EXISTS "AgentExecution_workflowAddress_nodeId_idx";
CREATE UNIQUE INDEX "AgentExecution_workflowAddress_nodeId_jobId_executionType_key"
  ON "AgentExecution"("workflowAddress", "nodeId", "jobId", "executionType");
CREATE INDEX "AgentExecution_workflowAddress_nodeId_executionType_idx"
  ON "AgentExecution"("workflowAddress", "nodeId", "executionType");

ALTER TABLE "EvaluatorDecision"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "executionType" TEXT;

UPDATE "EvaluatorDecision"
SET "jobId" = 'legacy:' || "id",
    "executionType" = 'service';

ALTER TABLE "EvaluatorDecision"
  ALTER COLUMN "jobId" SET NOT NULL,
  ALTER COLUMN "executionType" SET NOT NULL;

DROP INDEX IF EXISTS "EvaluatorDecision_workflowAddress_nodeId_idx";
CREATE UNIQUE INDEX "EvaluatorDecision_workflowAddress_nodeId_jobId_executionType_key"
  ON "EvaluatorDecision"("workflowAddress", "nodeId", "jobId", "executionType");
CREATE INDEX "EvaluatorDecision_workflowAddress_nodeId_executionType_idx"
  ON "EvaluatorDecision"("workflowAddress", "nodeId", "executionType");

ALTER TABLE "ChainTransaction"
  ADD COLUMN "logicalActionKey" TEXT,
  ADD COLUMN "transactionNonce" INTEGER,
  ADD COLUMN "verificationMethod" TEXT,
  ADD COLUMN "verificationResult" JSONB,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "replacedByHash" TEXT;

CREATE INDEX "ChainTransaction_logicalActionKey_status_idx"
  ON "ChainTransaction"("logicalActionKey", "status");
