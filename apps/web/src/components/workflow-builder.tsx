"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  getAddress,
  formatUnits,
  isAddress,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
} from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  ARC_TESTNET_USDC,
  workflowFactoryAbi,
} from "@agentsaga/contracts";

type BuilderNode = {
  name: string;
  provider: string;
  evaluator: string;
  budget: string;
  dependencies: number[];
  specification: string;
  compensationPolicy: "none" | "remediation" | "manual";
  compensationBudget: string;
  humanApproval: boolean;
};

const blankNode = (index: number): BuilderNode => ({
  name: ["Research", "Document", "Risk", "Payment", "Audit"][index] ?? `Node ${index + 1}`,
  provider: "",
  evaluator: "",
  budget: "10",
  dependencies: index === 0 ? [] : [index - 1],
  specification: "",
  compensationPolicy: index < 2 ? "remediation" : "none",
  compensationBudget: index < 2 ? "2" : "0",
  humanApproval: index === 3,
});

function parseUsdc(value: string): bigint {
  if (!/^\d+(\.\d{0,6})?$/.test(value)) throw new Error("Use up to 6 USDC decimals");
  return parseUnits(value, 6);
}

export function hasCycle(nodes: Pick<BuilderNode, "dependencies">[]): boolean {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (nodeId: number): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const dependency of nodes[nodeId]?.dependencies ?? []) {
      if (dependency < 0 || dependency >= nodes.length || visit(dependency)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return nodes.some((_, index) => visit(index));
}

function dependencyMask(dependencies: number[]): number {
  return dependencies.reduce((mask, dependency) => mask | (1 << dependency), 0);
}

export function WorkflowBuilder({ factoryAddress }: { factoryAddress: Address | undefined }) {
  const [nodes, setNodes] = useState<BuilderNode[]>(() => Array.from({ length: 5 }, (_, index) => blankNode(index)));
  const [deadlineDays, setDeadlineDays] = useState("5");
  const [metadataUri, setMetadataUri] = useState("urn:agentsaga:workflow:draft");
  const [formError, setFormError] = useState<string>();
  const account = useAccount();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  const totals = useMemo(() => {
    try {
      const service = nodes.reduce((sum, node) => sum + parseUsdc(node.budget), 0n);
      const compensation = nodes.reduce(
        (sum, node) => sum + parseUsdc(node.compensationBudget),
        0n,
      );
      return { service, compensation, valid: true };
    } catch {
      return { service: 0n, compensation: 0n, valid: false };
    }
  }, [nodes]);

  const updateNode = <K extends keyof BuilderNode>(index: number, key: K, value: BuilderNode[K]) => {
    setNodes((current) => current.map((node, nodeIndex) => nodeIndex === index ? { ...node, [key]: value } : node));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    try {
      if (factoryAddress === undefined) throw new Error("WorkflowFactory is not deployed/configured yet");
      if (!account.isConnected || account.address === undefined) throw new Error("Connect an Arc Testnet wallet first");
      if (hasCycle(nodes)) throw new Error("The workflow graph contains a cycle");
      if (!totals.valid || totals.service === 0n) throw new Error("Enter valid node budgets");
      if (nodes.some((node) => !isAddress(node.provider) || !isAddress(node.evaluator))) {
        throw new Error("Every provider and evaluator must be a valid EVM address");
      }
      const days = Number.parseInt(deadlineDays, 10);
      if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error("Deadline must be 1–30 days");
      // uint48 values are represented as JavaScript numbers by viem. The
      // deadline is well below Number.MAX_SAFE_INTEGER for any realistic
      // workflow window, so keep it as a number at the ABI boundary.
      const deadline = Math.floor(Date.now() / 1000) + days * 86_400;
      const canonicalDag = nodes.map((node, id) => ({ id, name: node.name, dependencies: [...node.dependencies].sort() }));
      const dagHash = keccak256(stringToHex(JSON.stringify(canonicalDag)));
      const userSalt = keccak256(stringToHex(`${account.address}:${Date.now()}:${dagHash}`));
      write.mutate({
        address: factoryAddress,
        abi: workflowFactoryAbi,
        functionName: "createWorkflow",
        args: [
          ARC_TESTNET_USDC,
          totals.service,
          totals.compensation,
          deadline,
          dagHash,
          metadataUri,
          userSalt,
          nodes.map((node, index) => {
            const compensationBudget = parseUsdc(node.compensationBudget);
            const specificationHash = keccak256(stringToHex(node.specification || `${node.name} specification`));
            return {
              provider: getAddress(node.provider),
              evaluator: getAddress(node.evaluator),
              budget: parseUsdc(node.budget),
              compensationBudget,
              expiry: deadline - 3_600,
              dependencyMask: dependencyMask(node.dependencies),
              specificationHash,
              compensationSpecificationHash: compensationBudget === 0n
                ? `0x${"0".repeat(64)}` as const
                : keccak256(stringToHex(`compensate:${node.name}:${node.specification}`)),
              compensationType: node.compensationPolicy === "none" ? 0 : node.compensationPolicy === "remediation" ? 1 : 5,
              humanApprovalRequired: node.humanApproval,
              metadataURI: `urn:agentsaga:node:${index}:${keccak256(stringToHex(node.name))}`,
            };
          }),
        ],
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Invalid workflow");
    }
  };

  return (
    <form className="builder-layout" onSubmit={submit}>
      <div className="builder-main">
        <div className="panel panel-heading">
          <div>
            <p className="eyebrow">Canonical DAG · maximum 16 nodes</p>
            <h2>Workflow graph</h2>
          </div>
          <button
            className="button button-quiet"
            type="button"
            disabled={nodes.length >= 16}
            onClick={() => setNodes((current) => [...current, blankNode(current.length)])}
          >
            Add node
          </button>
        </div>

        <div className="dag-strip" aria-label="Workflow dependency graph">
          {nodes.map((node, index) => (
            <div className="dag-node-wrap" key={index}>
              {index > 0 && <span className="dag-connector" aria-hidden="true">→</span>}
              <div className="dag-node"><small>{String(index + 1).padStart(2, "0")}</small><strong>{node.name || "Untitled"}</strong><span>{node.dependencies.length} deps</span></div>
            </div>
          ))}
        </div>

        <div className="node-stack">
          {nodes.map((node, index) => (
            <fieldset className="node-editor" key={index}>
              <legend><span>{String(index + 1).padStart(2, "0")}</span>{node.name || `Node ${index + 1}`}</legend>
              <div className="form-grid">
                <label>Node name<input value={node.name} onChange={(event) => updateNode(index, "name", event.target.value)} required /></label>
                <label>Service budget (USDC)<input inputMode="decimal" value={node.budget} onChange={(event) => updateNode(index, "budget", event.target.value)} required /></label>
                <label className="span-2">Provider address<input value={node.provider} onChange={(event) => updateNode(index, "provider", event.target.value)} placeholder="0x…" required /></label>
                <label className="span-2">Evaluator address<input value={node.evaluator} onChange={(event) => updateNode(index, "evaluator", event.target.value)} placeholder="0x…" required /></label>
                <label className="span-2">Specification<textarea value={node.specification} onChange={(event) => updateNode(index, "specification", event.target.value)} placeholder="Acceptance criteria and evidence requirements" /></label>
                <div className="span-2 field-group"><span>Dependencies</span><div className="dependency-list">
                  {nodes.slice(0, index).map((prior, dependency) => (
                    <label className="check-pill" key={dependency}>
                      <input type="checkbox" checked={node.dependencies.includes(dependency)} onChange={(event) => updateNode(index, "dependencies", event.target.checked ? [...node.dependencies, dependency] : node.dependencies.filter((id) => id !== dependency))} />
                      {prior.name || `Node ${dependency + 1}`}
                    </label>
                  ))}
                  {index === 0 && <span className="muted">Root node</span>}
                </div></div>
                <label>Compensation policy<select value={node.compensationPolicy} onChange={(event) => updateNode(index, "compensationPolicy", event.target.value as BuilderNode["compensationPolicy"])}><option value="none">None required</option><option value="remediation">Open remediation job</option><option value="manual">Manual recovery</option></select></label>
                <label>Compensation budget<input inputMode="decimal" value={node.compensationBudget} disabled={node.compensationPolicy === "none"} onChange={(event) => updateNode(index, "compensationBudget", event.target.value)} /></label>
                <label className="check-line span-2"><input type="checkbox" checked={node.humanApproval} onChange={(event) => updateNode(index, "humanApproval", event.target.checked)} /> Require operator approval before activation</label>
              </div>
              {nodes.length > 1 && <button className="text-button danger" type="button" onClick={() => setNodes((current) => current.filter((_, id) => id !== index).map((item) => ({ ...item, dependencies: item.dependencies.filter((dependency) => dependency !== index).map((dependency) => dependency > index ? dependency - 1 : dependency) })))}>Remove node</button>}
            </fieldset>
          ))}
        </div>
      </div>

      <aside className="builder-summary">
        <div className="panel sticky-panel">
          <p className="eyebrow">Funding envelope</p>
          <h2>{totals.valid ? formatUnits(totals.service + totals.compensation, 6) : "—"} <small>USDC</small></h2>
          <dl className="summary-list">
            <div><dt>Service budgets</dt><dd>{formatUnits(totals.service, 6)}</dd></div>
            <div><dt>Compensation reserve</dt><dd>{formatUnits(totals.compensation, 6)}</dd></div>
            <div><dt>Protocol fee</dt><dd>Registry policy</dd></div>
            <div><dt>Unallocated</dt><dd>0.00</dd></div>
          </dl>
          <label>Global deadline (days)<input value={deadlineDays} onChange={(event) => setDeadlineDays(event.target.value)} inputMode="numeric" /></label>
          <label>Metadata URI<input value={metadataUri} onChange={(event) => setMetadataUri(event.target.value)} /></label>
          <div className="validation-box"><span className={hasCycle(nodes) ? "state state-failed" : "state state-complete"}>{hasCycle(nodes) ? "Cycle detected" : "Graph is acyclic"}</span><p>Contract repeats bounded topological validation; the browser is not trusted.</p></div>
          {factoryAddress === undefined && <p className="form-message warning">Deployment address is not configured. The draft remains local.</p>}
          {formError !== undefined && <p className="form-message error" role="alert">{formError}</p>}
          {write.error !== null && <p className="form-message error" role="alert">{write.error.message}</p>}
          {write.data !== undefined && <p className="form-message success">Transaction submitted: {write.data.slice(0, 10)}…</p>}
          {receipt.isSuccess && <p className="form-message success">Workflow factory transaction confirmed on Arc Testnet.</p>}
          <button className="button button-primary button-full" type="submit" disabled={write.isPending || receipt.isLoading}>{write.isPending ? "Confirm in wallet…" : receipt.isLoading ? "Confirming…" : "Create workflow"}</button>
          <p className="fine-print">Creation registers the coordinator. Funding is a separate exact-amount USDC approval and deposit step.</p>
        </div>
      </aside>
    </form>
  );
}
