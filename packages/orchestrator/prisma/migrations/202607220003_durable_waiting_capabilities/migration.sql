ALTER TABLE "WorkerAction"
  ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "resumeAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "resumeSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "waitingReason" TEXT,
  ADD COLUMN "lastResult" JSONB,
  ADD COLUMN "transactionHash" TEXT,
  ADD COLUMN "transactionNonce" INTEGER,
  ADD COLUMN "signerRole" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "WorkerAction_status_nextAttemptAt_idx" ON "WorkerAction"("status", "nextAttemptAt");

ALTER TABLE "Workflow"
  ADD COLUMN "statusCode" INTEGER,
  ADD COLUMN "statusLabel" TEXT;

CREATE TABLE "WorkflowJob" (
  "id" TEXT PRIMARY KEY,
  "workflowAddress" TEXT NOT NULL REFERENCES "Workflow"("address") ON DELETE CASCADE,
  "nodeId" INTEGER NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "provider" TEXT,
  "evaluator" TEXT,
  "status" TEXT NOT NULL,
  "createdBlock" BIGINT NOT NULL,
  "state" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "WorkflowJob_workflowAddress_jobId_key" ON "WorkflowJob"("workflowAddress", "jobId");
CREATE INDEX "WorkflowJob_workflowAddress_nodeId_jobType_idx" ON "WorkflowJob"("workflowAddress", "nodeId", "jobType");

CREATE TABLE "ProcessorCapability" (
  "processor" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "detail" TEXT,
  "processId" INTEGER,
  "gitCommit" TEXT,
  "heartbeatAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);
