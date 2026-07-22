# Workflow state machine

Workflow states are Draft → Funded → Active → Completed, with
PartiallyCompleted/Compensating/Failed/Cancelled/Expired terminal or recovery
paths. Node states are Blocked → Ready → Funded → Running → Submitted →
Completed or Rejected/Failed/Expired; failed descendants become Skipped.

Activation checks all dependency bits against the completed mask and rejects
any ancestor failure. Finalization is one-way and writes a permanent receipt.
