# Compensation model

Refund returns unallocated escrowed USDC to the owner. Rollback is an atomic
transaction revert. Compensation is a separate, explicitly funded action that
may be a remediation job, predefined refund transfer, operator approval,
evaluator approval, or manual recovery marker.

When a downstream node fails, affected descendants cannot activate. Required
compensations are planned in reverse dependency order and charged only to the
reserved compensation budget. Legitimate provider payments are not clawed back
without a separate collateral agreement.
