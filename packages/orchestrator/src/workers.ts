export interface WorkerAction {
  idempotencyKey: string;
  type: "activate-node" | "expire-workflow" | "open-compensation" | "build-receipt";
  workflow: string;
  nodeId?: number;
  payload: Record<string, unknown>;
}

export interface ActionLedger {
  claim(action: WorkerAction): Promise<boolean>;
  complete(idempotencyKey: string): Promise<void>;
  fail(idempotencyKey: string, error: string): Promise<void>;
}

export class InMemoryActionLedger implements ActionLedger {
  private readonly states = new Map<string, "running" | "complete" | "failed">();

  async claim(action: WorkerAction): Promise<boolean> {
    if (this.states.has(action.idempotencyKey)) return false;
    this.states.set(action.idempotencyKey, "running");
    return true;
  }

  async complete(idempotencyKey: string): Promise<void> {
    this.states.set(idempotencyKey, "complete");
  }

  async fail(idempotencyKey: string, _error: string): Promise<void> {
    this.states.set(idempotencyKey, "failed");
  }
}

export class IdempotentWorker {
  constructor(
    private readonly ledger: ActionLedger,
    private readonly executeAction: (action: WorkerAction) => Promise<void>,
  ) {}

  async execute(action: WorkerAction): Promise<"executed" | "duplicate"> {
    if (!(await this.ledger.claim(action))) return "duplicate";
    try {
      await this.executeAction(action);
      await this.ledger.complete(action.idempotencyKey);
      return "executed";
    } catch (error) {
      await this.ledger.fail(
        action.idempotencyKey,
        error instanceof Error ? error.message : "unknown worker error",
      );
      throw error;
    }
  }
}

