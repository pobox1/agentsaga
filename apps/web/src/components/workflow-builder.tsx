"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  encodeAbiParameters,
  getAddress,
  formatUnits,
  isAddress,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
} from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  arcTestnet,
  ARC_TESTNET_USDC,
  workflowFactoryAbi,
} from "@agentsaga/contracts";
import { pendingTransactionFromHash, recoverPendingTransaction, trackPendingTransaction } from "../lib/transactions";

type BuilderNode = {
  name: string;
  provider: string;
  evaluator: string;
  budget: string;
  dependencies: number[];
  specification: string;
  providerAgentId: string;
  evaluatorAgentId: string;
  expiryHours: string;
  metadataUri: string;
  compensationSpecification: string;
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
  providerAgentId: "",
  evaluatorAgentId: "",
  expiryHours: "24",
  metadataUri: `urn:agentsaga:node:${index}`,
  compensationSpecification: "",
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
  const [pendingHash, setPendingHash] = useState<`0x${string}`>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [predictedAddress, setPredictedAddress] = useState<Address>();
  const [estimatedGas, setEstimatedGas] = useState<bigint>();
  const account = useAccount();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const walletClient = useWalletClient({ chainId: arcTestnet.id });
  const switchChain = useSwitchChain();
  const router = useRouter();

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    setIsSubmitting(true);
    try {
      if (factoryAddress === undefined) throw new Error("WorkflowFactory is not deployed/configured yet");
      if (!account.isConnected || account.address === undefined) throw new Error("Connect an Arc Testnet wallet first");
      if (account.chainId !== arcTestnet.id) await switchChain.mutateAsync({ chainId: arcTestnet.id });
      if (publicClient === undefined || walletClient.data === undefined) throw new Error("Arc wallet provider is unavailable");
      if (await walletClient.data.getChainId() !== arcTestnet.id) throw new Error("Wallet provider is not on Arc Testnet");
      if (hasCycle(nodes)) throw new Error("The workflow graph contains a cycle");
      if (!totals.valid || totals.service === 0n) throw new Error("Enter valid node budgets");
      if (!reviewConfirmed) throw new Error("Complete the final workflow review before signing");
      if (nodes.some((node) => !isAddress(node.provider) || !isAddress(node.evaluator))) {
        throw new Error("Every provider and evaluator must be a valid EVM address");
      }
      const days = Number.parseInt(deadlineDays, 10);
      if (nodes.some((node) => !Number.isSafeInteger(Number(node.expiryHours)) || Number(node.expiryHours) < 1 || Number(node.expiryHours) > days * 24)) throw new Error("Each node expiry must be within the global deadline");
      if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error("Deadline must be 1–30 days");
      // uint48 values are represented as JavaScript numbers by viem. The
      // deadline is well below Number.MAX_SAFE_INTEGER for any realistic
      // workflow window, so keep it as a number at the ABI boundary.
      const deadline = Math.floor(Date.now() / 1000) + days * 86_400;
      const canonicalDag = nodes.map((node, id) => ({ id, name: node.name, dependencies: [...node.dependencies].sort(), providerAgentId: node.providerAgentId || null, evaluatorAgentId: node.evaluatorAgentId || null }));
      const dagHash = keccak256(stringToHex(JSON.stringify(canonicalDag)));
      const userSalt = keccak256(stringToHex(`${account.address}:${Date.now()}:${dagHash}`));
      const contractNodes = nodes.map((node, index) => {
        const compensationBudget = parseUsdc(node.compensationBudget);
        if (node.compensationPolicy === "manual" && compensationBudget !== 0n) {
          throw new Error(`Manual recovery for node ${index + 1} must use a zero autonomous budget`);
        }
        return {
          provider: getAddress(node.provider), evaluator: getAddress(node.evaluator),
          budget: parseUsdc(node.budget), compensationBudget, expiry: Math.min(deadline - 60, Math.floor(Date.now() / 1000) + Number(node.expiryHours) * 3_600),
          dependencyMask: dependencyMask(node.dependencies),
          specificationHash: keccak256(stringToHex(node.specification || `${node.name} specification`)),
          compensationSpecificationHash: node.compensationPolicy === "none"
            ? `0x${"0".repeat(64)}` as const
            : keccak256(stringToHex(node.compensationSpecification || `compensate:${node.name}:${node.specification}`)),
          compensationType: node.compensationPolicy === "none" ? 0 : node.compensationPolicy === "remediation" ? 1 : 2,
          humanApprovalRequired: node.humanApproval,
          metadataURI: node.metadataUri,
        };
      });
      const args = [ARC_TESTNET_USDC, totals.service, totals.compensation, deadline, dagHash, metadataUri, userSalt, contractNodes] as const;
      const expectedSpecificationHash = keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint96" }, { type: "uint96" }, { type: "uint48" }, { type: "uint256" }],
        [dagHash, keccak256(stringToHex(metadataUri)), totals.service, totals.compensation, deadline, BigInt(nodes.length)],
      ));
      const ownerNonce = await publicClient.readContract({ address: factoryAddress, abi: workflowFactoryAbi, functionName: "ownerNonce", args: [account.address] });
      const predictedWorkflow = await publicClient.readContract({ address: factoryAddress, abi: workflowFactoryAbi, functionName: "predictWorkflowAddress", args: [account.address, ownerNonce, ...args] });
      setPredictedAddress(predictedWorkflow);
      setEstimatedGas(await publicClient.estimateContractGas({ account: account.address, address: factoryAddress, abi: workflowFactoryAbi, functionName: "createWorkflow", args }));
      const simulation = await publicClient.simulateContract({
        account: account.address,
        address: factoryAddress,
        abi: workflowFactoryAbi,
        functionName: "createWorkflow",
        args,
      });
      const hash = await walletClient.data.writeContract(simulation.request);
      setPendingHash(hash);
      const pending = await pendingTransactionFromHash(publicClient, {
        action: "create-workflow",
        chainId: arcTestnet.id,
        hash,
        workflow: predictedWorkflow,
        expectedEmitter: factoryAddress,
        expectedEvent: "WorkflowCreated",
        expectedOwner: account.address,
        expectedSpecificationHash,
      });
      trackPendingTransaction(pending);
      await publicClient.waitForTransactionReceipt({ hash });
      const recovered = await recoverPendingTransaction(publicClient, pending);
      if (recovered.status !== "ConfirmedEventVerified" && recovered.status !== "ConfirmedStateVerified") throw new Error(recovered.error ?? "Workflow creation could not be verified");
      const createdWorkflow = recovered.resultingWorkflow ?? predictedWorkflow;
      window.localStorage.setItem(`agentsaga:workflow:${createdWorkflow}`, JSON.stringify({
        workflow: createdWorkflow, transactionHash: hash,
      }));
      router.push(`/workflows/${createdWorkflow}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Invalid workflow");
    } finally {
      setIsSubmitting(false);
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
                <label>Provider ERC-8004 ID<input value={node.providerAgentId} onChange={(event) => updateNode(index, "providerAgentId", event.target.value)} placeholder="Optional metadata" /></label>
                <label>Evaluator ERC-8004 ID<input value={node.evaluatorAgentId} onChange={(event) => updateNode(index, "evaluatorAgentId", event.target.value)} placeholder="Optional metadata" /></label>
                <label>Expiry (hours)<input inputMode="numeric" value={node.expiryHours} onChange={(event) => updateNode(index, "expiryHours", event.target.value)} required /></label>
                <label>Node metadata URI<input value={node.metadataUri} onChange={(event) => updateNode(index, "metadataUri", event.target.value)} required /></label>
                <label className="span-2">Compensation specification<textarea value={node.compensationSpecification} onChange={(event) => updateNode(index, "compensationSpecification", event.target.value)} placeholder="Explicit remediation acceptance criteria" /></label>
                <div className="span-2 field-group"><span>Dependencies</span><div className="dependency-list">
                  {nodes.slice(0, index).map((prior, dependency) => (
                    <label className="check-pill" key={dependency}>
                      <input type="checkbox" checked={node.dependencies.includes(dependency)} onChange={(event) => updateNode(index, "dependencies", event.target.checked ? [...node.dependencies, dependency] : node.dependencies.filter((id) => id !== dependency))} />
                      {prior.name || `Node ${dependency + 1}`}
                    </label>
                  ))}
                  {index === 0 && <span className="muted">Root node</span>}
                </div></div>
                <label>Compensation policy<select value={node.compensationPolicy} onChange={(event) => {
                  const policy = event.target.value as BuilderNode["compensationPolicy"];
                  updateNode(index, "compensationPolicy", policy);
                  if (policy !== "remediation") updateNode(index, "compensationBudget", "0");
                }}><option value="none">None required</option><option value="remediation">Open remediation job</option><option value="manual">Manual recovery</option></select></label>
                <label>Compensation budget<input inputMode="decimal" value={node.compensationBudget} disabled={node.compensationPolicy !== "remediation"} onChange={(event) => updateNode(index, "compensationBudget", event.target.value)} /></label>
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
          <div className="validation-box"><strong>Final workflow review</strong><p>{nodes.length} nodes · exact maximum funding {formatUnits(totals.service + totals.compensation, 6)} USDC · {nodes.filter((node) => node.humanApproval).length} human gate(s)</p>{predictedAddress && <p>Predicted coordinator: <code>{predictedAddress}</code></p>}{estimatedGas !== undefined && <p>Estimated creation gas: {estimatedGas.toString()}</p>}<label className="check-line"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /> I reviewed roles, graph, budgets, expiries and compensation.</label></div>
          {factoryAddress === undefined && <p className="form-message warning">Deployment address is not configured. The draft remains local.</p>}
          {formError !== undefined && <p className="form-message error" role="alert">{formError}</p>}
          {pendingHash !== undefined && <p className="form-message success">Pending transaction: <a href={`${arcTestnet.blockExplorers.default.url}/tx/${pendingHash}`} target="_blank" rel="noreferrer">{pendingHash.slice(0, 10)}…</a></p>}
          <button className="button button-primary button-full" type="submit" disabled={isSubmitting}>{isSubmitting ? "Simulating and confirming…" : "Create workflow"}</button>
          <p className="fine-print">Creation registers the coordinator. Funding is a separate exact-amount USDC approval and deposit step.</p>
        </div>
      </aside>
    </form>
  );
}
