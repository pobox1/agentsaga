ALTER INDEX "IndexedEvent_sourceId_projectionStatus_nextProjectionAttemptAt_"
  RENAME TO "IndexedEvent_projection_queue_idx";

ALTER INDEX "EvaluatorDecision_workflowAddress_nodeId_jobId_executionType_ke"
  RENAME TO "EvaluatorDecision_job_context_key";
