ALTER TABLE "WorkflowNode"
  DROP CONSTRAINT "WorkflowNode_workflowAddress_fkey",
  ADD CONSTRAINT "WorkflowNode_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentExecution"
  DROP CONSTRAINT "AgentExecution_workflowAddress_fkey",
  ADD CONSTRAINT "AgentExecution_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvaluatorDecision"
  DROP CONSTRAINT "EvaluatorDecision_workflowAddress_fkey",
  ADD CONSTRAINT "EvaluatorDecision_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChainTransaction"
  DROP CONSTRAINT "ChainTransaction_workflowAddress_fkey",
  ADD CONSTRAINT "ChainTransaction_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceRecord"
  DROP CONSTRAINT "EvidenceRecord_workflowAddress_fkey",
  ADD CONSTRAINT "EvidenceRecord_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowJob"
  DROP CONSTRAINT "WorkflowJob_workflowAddress_fkey",
  ADD CONSTRAINT "WorkflowJob_workflowAddress_fkey"
    FOREIGN KEY ("workflowAddress") REFERENCES "Workflow"("address")
    ON DELETE CASCADE ON UPDATE CASCADE;
