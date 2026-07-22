// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PolicyRegistry } from "./PolicyRegistry.sol";
import { AgentJobAdapter } from "./AgentJobAdapter.sol";
import { WorkflowReceiptRegistry } from "./WorkflowReceiptRegistry.sol";
import { IAgentJobCallback } from "./interfaces/IAgentJobCallback.sol";

/// @notice Financial state machine for at most 16 topologically ordered dependent agent jobs.
contract WorkflowCoordinator is ReentrancyGuard, IAgentJobCallback {
    using SafeERC20 for IERC20;

    uint48 public constant MAX_COMPENSATION_GRACE = 7 days;

    enum WorkflowStatus {
        Draft,
        Funded,
        Active,
        PartiallyCompleted,
        Compensating,
        Completed,
        Failed,
        Cancelled,
        Expired
    }

    enum NodeStatus {
        Blocked,
        Ready,
        Funded,
        Running,
        Submitted,
        Completed,
        Rejected,
        Failed,
        Skipped,
        Compensating,
        Compensated,
        Expired
    }

    enum CompensationType {
        None,
        RemediationJob,
        PredefinedRefundTransfer,
        OperatorApproval,
        EvaluatorApproval,
        ManualRecovery
    }

    struct NodeInput {
        address provider;
        address evaluator;
        uint96 budget;
        uint96 compensationBudget;
        uint48 expiry;
        uint16 dependencyMask;
        bytes32 specificationHash;
        bytes32 compensationSpecificationHash;
        CompensationType compensationType;
        bool humanApprovalRequired;
        string metadataURI;
    }

    struct Node {
        address provider;
        address evaluator;
        uint96 budget;
        uint96 compensationBudget;
        uint48 expiry;
        uint16 dependencyMask;
        uint256 jobId;
        bytes32 specificationHash;
        bytes32 compensationSpecificationHash;
        CompensationType compensationType;
        NodeStatus status;
        bool humanApprovalRequired;
        bool humanApproved;
        string metadataURI;
    }

    struct JobReference {
        uint8 nodeId;
        bool compensation;
        bool exists;
    }

    struct Compensation {
        uint96 budget;
        uint48 deadline;
        uint256 jobId;
        address provider;
        address evaluator;
        bytes32 specificationHash;
        bytes32 evidenceHash;
        bool opened;
        bool resolved;
        bool unresolved;
    }

    error Unauthorized();
    error InvalidAddress();
    error InvalidBudget();
    error InvalidDeadline();
    error InvalidGraph();
    error InvalidNode();
    error InvalidState();
    error DependencyNotSatisfied();
    error HumanApprovalRequired();
    error AlreadyApproved();
    error FeeOnTransferUnsupported();
    error AccountingInvariantBroken();
    error CompensationOrderViolation();
    error CompensationUnavailable();
    error EmergencyPaused();

    address public immutable owner;
    IERC20 public immutable paymentToken;
    PolicyRegistry public immutable policyRegistry;
    WorkflowReceiptRegistry public immutable receiptRegistry;
    AgentJobAdapter public immutable jobAdapter;
    address public immutable treasury;
    uint64 public immutable policyVersion;
    uint64 public immutable createdBlock;
    uint48 public immutable globalDeadline;
    uint96 public immutable totalBudget;
    uint96 public immutable executionBudget;
    uint96 public immutable configuredCompensationReserve;
    uint96 public immutable humanApprovalThreshold;
    uint16 public immutable protocolFeeBps;
    uint8 public immutable nodeCount;
    uint16 public immutable allNodesMask;
    bytes32 public immutable dagSpecificationHash;
    bytes32 public immutable workflowSpecificationHash;
    string public metadataURI;

    WorkflowStatus public status;
    bool public finalized;
    uint16 public completedMask;
    uint16 public failedMask;
    uint16 public skippedMask;
    uint16 public compensationPendingMask;
    uint16 public compensatedMask;
    uint16 public compensationUnresolvedMask;

    uint96 public deposited;
    uint96 public available;
    uint96 public reservedForJobs;
    uint96 public reservedForCompensation;
    uint96 public paidToProviders;
    uint96 public compensationSpent;
    uint96 public refunded;
    uint96 public protocolFees;

    bytes32 public evidenceAccumulator;
    bytes32 public executionTraceHash;

    mapping(uint8 nodeId => Node node) private _nodes;
    mapping(uint256 jobId => JobReference jobRef) public jobReferences;
    mapping(uint8 nodeId => Compensation compensation) private _compensations;

    event WorkflowFunded(address indexed owner, uint96 amount);
    event WorkflowStatusChanged(WorkflowStatus indexed previous, WorkflowStatus indexed current);
    event NodeReady(uint8 indexed nodeId);
    event NodeApproved(uint8 indexed nodeId, address indexed approver);
    event NodeActivated(uint8 indexed nodeId, uint256 indexed jobId, uint96 budget);
    event NodeSubmitted(uint8 indexed nodeId, uint256 indexed jobId, bytes32 deliverableHash);
    event NodeCompleted(
        uint8 indexed nodeId,
        uint256 indexed jobId,
        address indexed provider,
        uint96 paid,
        uint96 fee
    );
    event NodeRejected(uint8 indexed nodeId, uint256 indexed jobId, bytes32 reason);
    event NodeSkipped(uint8 indexed nodeId, uint8 indexed failedAncestor);
    event CompensationPlanned(uint16 indexed pendingMask, uint96 reservedBudget);
    event CompensationJobOpened(
        uint8 indexed nodeId, uint256 indexed jobId, address indexed provider, uint96 budget
    );
    event CompensationCompleted(
        uint8 indexed nodeId, uint256 indexed jobId, uint96 spent, bytes32 evidenceHash
    );
    event CompensationUnresolved(uint8 indexed nodeId, bytes32 evidenceHash);
    event Refunded(address indexed owner, uint96 amount);

    constructor(
        address workflowOwner,
        address token,
        PolicyRegistry registry,
        WorkflowReceiptRegistry receipts,
        uint96 workflowExecutionBudget,
        uint96 compensationReserve,
        uint48 deadline,
        bytes32 dagHash,
        string memory workflowMetadataURI,
        NodeInput[] memory inputs
    ) {
        if (
            workflowOwner == address(0) || token == address(0) || address(registry) == address(0)
                || address(receipts) == address(0)
        ) revert InvalidAddress();
        if (deadline <= block.timestamp || dagHash == bytes32(0)) revert InvalidDeadline();
        uint256 total = uint256(workflowExecutionBudget) + compensationReserve;
        if (total > type(uint96).max || workflowExecutionBudget == 0) revert InvalidBudget();

        PolicyRegistry.Limits memory snapshot = registry.validateWorkflow(
            token, uint96(total), compensationReserve, uint8(inputs.length)
        );

        owner = workflowOwner;
        paymentToken = IERC20(token);
        policyRegistry = registry;
        receiptRegistry = receipts;
        treasury = registry.treasury();
        policyVersion = registry.version();
        createdBlock = uint64(block.number);
        globalDeadline = deadline;
        totalBudget = uint96(total);
        executionBudget = workflowExecutionBudget;
        configuredCompensationReserve = compensationReserve;
        humanApprovalThreshold = snapshot.humanApprovalThreshold;
        protocolFeeBps = snapshot.protocolFeeBps;
        nodeCount = uint8(inputs.length);
        allNodesMask = uint16((uint256(1) << inputs.length) - 1);
        dagSpecificationHash = dagHash;
        metadataURI = workflowMetadataURI;
        workflowSpecificationHash = keccak256(
            abi.encode(
                dagHash,
                keccak256(bytes(workflowMetadataURI)),
                workflowExecutionBudget,
                compensationReserve,
                deadline,
                inputs.length
            )
        );

        AgentJobAdapter adapter = new AgentJobAdapter(token, address(this));
        jobAdapter = adapter;

        uint256 serviceSum;
        uint256 compensationSum;
        uint256 roots;
        for (uint8 i; i < inputs.length; ++i) {
            NodeInput memory input = inputs[i];
            registry.validateNode(input.provider, input.evaluator, input.budget);
            if (input.provider == address(0) || input.evaluator == address(0)) {
                revert InvalidAddress();
            }
            if (input.expiry <= block.timestamp || input.expiry > deadline) {
                revert InvalidDeadline();
            }
            if (input.specificationHash == bytes32(0)) revert InvalidNode();

            uint16 bit = uint16(uint256(1) << i);
            if ((input.dependencyMask & bit) != 0) revert InvalidGraph();
            uint16 priorMask = i == 0 ? 0 : uint16((uint256(1) << i) - 1);
            if ((input.dependencyMask & ~priorMask) != 0) revert InvalidGraph();
            if (input.dependencyMask == 0) ++roots;

            if (input.compensationType == CompensationType.None) {
                if (input.compensationBudget != 0) revert InvalidBudget();
            } else if (
                input.compensationBudget == 0 || input.compensationSpecificationHash == bytes32(0)
            ) {
                revert InvalidBudget();
            }

            serviceSum += input.budget;
            compensationSum += input.compensationBudget;
            uint256 jobId = adapter.createJob(
                input.provider,
                input.evaluator,
                input.expiry,
                input.metadataURI,
                input.specificationHash
            );
            adapter.setBudget(jobId, input.budget);
            _nodes[i] = Node({
                provider: input.provider,
                evaluator: input.evaluator,
                budget: input.budget,
                compensationBudget: input.compensationBudget,
                expiry: input.expiry,
                dependencyMask: input.dependencyMask,
                jobId: jobId,
                specificationHash: input.specificationHash,
                compensationSpecificationHash: input.compensationSpecificationHash,
                compensationType: input.compensationType,
                status: NodeStatus.Blocked,
                humanApprovalRequired: input.humanApprovalRequired
                    || input.budget >= snapshot.humanApprovalThreshold,
                humanApproved: false,
                metadataURI: input.metadataURI
            });
            jobReferences[jobId] = JobReference({ nodeId: i, compensation: false, exists: true });
        }
        if (
            roots == 0 || serviceSum > workflowExecutionBudget
                || compensationSum > compensationReserve
        ) {
            revert InvalidGraph();
        }
        status = WorkflowStatus.Draft;
        executionTraceHash =
            keccak256(abi.encodePacked("AGENTSAGA_CREATE", workflowSpecificationHash));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAdapter() {
        if (msg.sender != address(jobAdapter)) revert Unauthorized();
        _;
    }

    function getNode(uint8 nodeId) external view returns (Node memory) {
        if (nodeId >= nodeCount) revert InvalidNode();
        return _nodes[nodeId];
    }

    function getCompensation(uint8 nodeId) external view returns (Compensation memory) {
        if (nodeId >= nodeCount) revert InvalidNode();
        return _compensations[nodeId];
    }

    function fund() external onlyOwner nonReentrant {
        _requireNotPaused();
        if (status != WorkflowStatus.Draft) revert InvalidState();
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), totalBudget);
        uint256 received = paymentToken.balanceOf(address(this)) - beforeBalance;
        if (received != totalBudget) revert FeeOnTransferUnsupported();

        deposited = totalBudget;
        available = executionBudget;
        reservedForCompensation = configuredCompensationReserve;
        _setStatus(WorkflowStatus.Funded);
        _setStatus(WorkflowStatus.Active);
        _refreshReadyNodes();
        _recordTrace("FUND", type(uint8).max, bytes32(uint256(totalBudget)));
        emit WorkflowFunded(owner, totalBudget);
        _assertAccounting();
    }

    function approveNode(uint8 nodeId) external onlyOwner {
        if (nodeId >= nodeCount) revert InvalidNode();
        Node storage node = _nodes[nodeId];
        if (!node.humanApprovalRequired) revert HumanApprovalRequired();
        if (node.humanApproved) revert AlreadyApproved();
        if (node.status != NodeStatus.Blocked && node.status != NodeStatus.Ready) {
            revert InvalidState();
        }
        node.humanApproved = true;
        emit NodeApproved(nodeId, msg.sender);
    }

    function activateNode(uint8 nodeId) external nonReentrant {
        _requireNotPaused();
        if (nodeId >= nodeCount) revert InvalidNode();
        if (status != WorkflowStatus.Active && status != WorkflowStatus.PartiallyCompleted) {
            revert InvalidState();
        }
        Node storage node = _nodes[nodeId];
        if (node.status != NodeStatus.Ready) revert DependencyNotSatisfied();
        if (node.humanApprovalRequired && !node.humanApproved) revert HumanApprovalRequired();
        if (available < node.budget) revert InvalidBudget();

        available -= node.budget;
        reservedForJobs += node.budget;
        node.status = NodeStatus.Funded;
        jobAdapter.fund(node.jobId, node.budget);
        _recordTrace("ACTIVATE", nodeId, bytes32(node.jobId));
        emit NodeActivated(nodeId, node.jobId, node.budget);
        _assertAccounting();
    }

    function onJobSubmitted(uint256 jobId, bytes32 deliverableHash) external onlyAdapter {
        JobReference memory jobRef = jobReferences[jobId];
        if (!jobRef.exists) revert InvalidNode();
        if (jobRef.compensation) {
            Compensation storage compensation = _compensations[jobRef.nodeId];
            if (!compensation.opened || compensation.resolved) revert InvalidState();
        } else {
            Node storage node = _nodes[jobRef.nodeId];
            if (node.status != NodeStatus.Funded) revert InvalidState();
            node.status = NodeStatus.Submitted;
            emit NodeSubmitted(jobRef.nodeId, jobId, deliverableHash);
        }
        _recordEvidence(jobId, deliverableHash, bytes32(0));
    }

    function onJobCompleted(uint256 jobId, bytes32 deliverableHash, bytes32 reason)
        external
        onlyAdapter
        nonReentrant
    {
        _requireNotPaused();
        JobReference memory jobRef = jobReferences[jobId];
        if (!jobRef.exists) revert InvalidNode();
        _recordEvidence(jobId, deliverableHash, reason);
        if (jobRef.compensation) {
            _completeCompensation(jobRef.nodeId, jobId, deliverableHash);
        } else {
            _completeNode(jobRef.nodeId, jobId);
        }
        _assertAccounting();
    }

    function onJobRejected(uint256 jobId, bytes32 reason) external onlyAdapter {
        JobReference memory jobRef = jobReferences[jobId];
        if (!jobRef.exists) revert InvalidNode();
        _recordEvidence(jobId, bytes32(0), reason);
        if (jobRef.compensation) {
            _failCompensation(jobRef.nodeId, reason);
        } else {
            _rejectNode(jobRef.nodeId, jobId, reason, NodeStatus.Rejected);
        }
        _assertAccounting();
    }

    function onJobExpired(uint256 jobId) external onlyAdapter {
        JobReference memory jobRef = jobReferences[jobId];
        if (!jobRef.exists) revert InvalidNode();
        if (jobRef.compensation) {
            _failCompensation(jobRef.nodeId, keccak256("COMPENSATION_EXPIRED"));
        } else {
            _rejectNode(jobRef.nodeId, jobId, keccak256("JOB_EXPIRED"), NodeStatus.Expired);
        }
        _assertAccounting();
    }

    function openNextCompensation(
        uint8 nodeId,
        address provider,
        address evaluator,
        uint48 compensationDeadline
    ) external onlyOwner nonReentrant returns (uint256 jobId) {
        _requireNotPaused();
        if (status != WorkflowStatus.Compensating) revert InvalidState();
        if (nodeId >= nodeCount || provider == address(0) || evaluator == address(0)) {
            revert InvalidNode();
        }
        if (nodeId != _highestPendingCompensation()) revert CompensationOrderViolation();
        if (
            compensationDeadline <= block.timestamp
                || compensationDeadline > globalDeadline + MAX_COMPENSATION_GRACE
        ) revert InvalidDeadline();

        Compensation storage compensation = _compensations[nodeId];
        if (compensation.opened || compensation.resolved || compensation.unresolved) {
            revert CompensationUnavailable();
        }
        policyRegistry.validateNode(provider, evaluator, compensation.budget);
        jobId = jobAdapter.createJob(
            provider,
            evaluator,
            compensationDeadline,
            "AgentSaga compensation job",
            compensation.specificationHash
        );
        jobAdapter.setBudget(jobId, compensation.budget);
        jobAdapter.fund(jobId, compensation.budget);
        compensation.deadline = compensationDeadline;
        compensation.jobId = jobId;
        compensation.provider = provider;
        compensation.evaluator = evaluator;
        compensation.opened = true;
        jobReferences[jobId] = JobReference({ nodeId: nodeId, compensation: true, exists: true });
        _nodes[nodeId].status = NodeStatus.Compensating;
        _recordTrace("COMP_OPEN", nodeId, bytes32(jobId));
        emit CompensationJobOpened(nodeId, jobId, provider, compensation.budget);
    }

    function declareCompensationUnresolved(uint8 nodeId, bytes32 evidenceHash) external onlyOwner {
        if (status != WorkflowStatus.Compensating || nodeId >= nodeCount) revert InvalidState();
        if (nodeId != _highestPendingCompensation()) revert CompensationOrderViolation();
        Compensation storage compensation = _compensations[nodeId];
        if (compensation.opened || compensation.resolved || compensation.unresolved) {
            revert CompensationUnavailable();
        }
        compensation.unresolved = true;
        compensation.evidenceHash = evidenceHash;
        compensationPendingMask &= ~uint16(uint256(1) << nodeId);
        compensationUnresolvedMask |= uint16(uint256(1) << nodeId);
        _nodes[nodeId].status = NodeStatus.Failed;
        _recordTrace("COMP_UNRESOLVED", nodeId, evidenceHash);
        emit CompensationUnresolved(nodeId, evidenceHash);
        if (compensationPendingMask == 0) _finalizeFailedOutcome();
    }

    function cancelBeforeExecution() external onlyOwner nonReentrant {
        if (
            status != WorkflowStatus.Funded && status != WorkflowStatus.Active
                && status != WorkflowStatus.Draft
        ) revert InvalidState();
        if (completedMask != 0) revert InvalidState();
        if (status == WorkflowStatus.Draft) {
            finalized = true;
            _setStatus(WorkflowStatus.Cancelled);
            _writeReceipt(WorkflowStatus.Cancelled);
            return;
        }
        _closeUnfinishedJobs(NodeStatus.Skipped, keccak256("WORKFLOW_CANCELLED"));
        _finalize(WorkflowStatus.Cancelled);
    }

    function expireWorkflow() external nonReentrant {
        if (block.timestamp < globalDeadline) revert InvalidDeadline();
        if (finalized) revert InvalidState();
        _closeUnfinishedJobs(NodeStatus.Expired, keccak256("WORKFLOW_EXPIRED"));
        _finalize(WorkflowStatus.Expired);
    }

    function accountingInvariantHolds() public view returns (bool) {
        uint256 accounted = uint256(available) + reservedForJobs + reservedForCompensation
            + paidToProviders + compensationSpent + refunded + protocolFees;
        return accounted == deposited
            && paymentToken.balanceOf(address(this))
                == uint256(available) + reservedForJobs + reservedForCompensation;
    }

    function _completeNode(uint8 nodeId, uint256 jobId) private {
        Node storage node = _nodes[nodeId];
        if (node.status != NodeStatus.Submitted) revert InvalidState();
        node.status = NodeStatus.Completed;
        uint16 bit = uint16(uint256(1) << nodeId);
        completedMask |= bit;
        reservedForJobs -= node.budget;

        uint96 fee = uint96((uint256(node.budget) * protocolFeeBps) / 10_000);
        uint96 providerPayment = node.budget - fee;
        paidToProviders += providerPayment;
        protocolFees += fee;
        if (providerPayment != 0) paymentToken.safeTransfer(node.provider, providerPayment);
        if (fee != 0) paymentToken.safeTransfer(treasury, fee);

        _recordTrace("COMPLETE", nodeId, bytes32(jobId));
        emit NodeCompleted(nodeId, jobId, node.provider, providerPayment, fee);
        _refreshReadyNodes();
        _maybeSettleExecution();
    }

    function _rejectNode(uint8 nodeId, uint256 jobId, bytes32 reason, NodeStatus terminalStatus)
        private
    {
        Node storage node = _nodes[nodeId];
        if (node.status != NodeStatus.Funded && node.status != NodeStatus.Submitted) {
            revert InvalidState();
        }
        node.status = terminalStatus;
        uint16 bit = uint16(uint256(1) << nodeId);
        failedMask |= bit;
        reservedForJobs -= node.budget;
        available += node.budget;
        if (completedMask != 0) _setStatus(WorkflowStatus.PartiallyCompleted);
        _recordTrace("REJECT", nodeId, reason);
        emit NodeRejected(nodeId, jobId, reason);
        _propagateFailure(nodeId);
        _refreshReadyNodes();
        _maybeSettleExecution();
    }

    function _propagateFailure(uint8 failedNodeId) private {
        for (uint8 pass; pass < nodeCount; ++pass) {
            bool changed;
            uint16 stopMask = failedMask | skippedMask;
            for (uint8 i; i < nodeCount; ++i) {
                Node storage candidate = _nodes[i];
                if (
                    (candidate.status == NodeStatus.Blocked || candidate.status == NodeStatus.Ready)
                        && (candidate.dependencyMask & stopMask) != 0
                ) {
                    candidate.status = NodeStatus.Skipped;
                    skippedMask |= uint16(uint256(1) << i);
                    emit NodeSkipped(i, failedNodeId);
                    changed = true;
                }
            }
            if (!changed) break;
        }
    }

    function _refreshReadyNodes() private {
        if (status != WorkflowStatus.Active && status != WorkflowStatus.PartiallyCompleted) return;
        uint16 stopMask = failedMask | skippedMask;
        for (uint8 i; i < nodeCount; ++i) {
            Node storage node = _nodes[i];
            if (
                node.status == NodeStatus.Blocked && (node.dependencyMask & stopMask) == 0
                    && (node.dependencyMask & completedMask) == node.dependencyMask
            ) {
                node.status = NodeStatus.Ready;
                emit NodeReady(i);
            }
        }
    }

    function _maybeSettleExecution() private {
        if (completedMask == allNodesMask) {
            _finalize(WorkflowStatus.Completed);
            return;
        }
        if (failedMask != 0 && _executionIsTerminal()) _planCompensation();
    }

    function _executionIsTerminal() private view returns (bool) {
        for (uint8 i; i < nodeCount; ++i) {
            NodeStatus nodeStatus = _nodes[i].status;
            if (
                nodeStatus != NodeStatus.Completed && nodeStatus != NodeStatus.Rejected
                    && nodeStatus != NodeStatus.Failed && nodeStatus != NodeStatus.Skipped
                    && nodeStatus != NodeStatus.Expired
            ) return false;
        }
        return true;
    }

    function _planCompensation() private {
        uint16 pending;
        uint256 requiredBudget;
        for (uint8 i; i < nodeCount; ++i) {
            uint16 bit = uint16(uint256(1) << i);
            Node storage node = _nodes[i];
            if (
                (completedMask & bit) != 0 && node.compensationType != CompensationType.None
                    && node.compensationBudget != 0
            ) {
                pending |= bit;
                requiredBudget += node.compensationBudget;
                _compensations[i] = Compensation({
                    budget: node.compensationBudget,
                    deadline: 0,
                    jobId: 0,
                    provider: address(0),
                    evaluator: address(0),
                    specificationHash: node.compensationSpecificationHash,
                    evidenceHash: bytes32(0),
                    opened: false,
                    resolved: false,
                    unresolved: false
                });
            }
        }
        if (requiredBudget > reservedForCompensation) revert InvalidBudget();
        compensationPendingMask = pending;
        if (pending == 0) {
            _finalizeFailedOutcome();
        } else {
            _setStatus(WorkflowStatus.Compensating);
            emit CompensationPlanned(pending, reservedForCompensation);
        }
    }

    function _completeCompensation(uint8 nodeId, uint256 jobId, bytes32 evidenceHash) private {
        Compensation storage compensation = _compensations[nodeId];
        if (!compensation.opened || compensation.resolved || compensation.unresolved) {
            revert InvalidState();
        }
        compensation.resolved = true;
        compensation.evidenceHash = evidenceHash;
        reservedForCompensation -= compensation.budget;
        compensationSpent += compensation.budget;
        compensationPendingMask &= ~uint16(uint256(1) << nodeId);
        compensatedMask |= uint16(uint256(1) << nodeId);
        _nodes[nodeId].status = NodeStatus.Compensated;
        paymentToken.safeTransfer(compensation.provider, compensation.budget);
        _recordTrace("COMP_DONE", nodeId, evidenceHash);
        emit CompensationCompleted(nodeId, jobId, compensation.budget, evidenceHash);
        if (compensationPendingMask == 0) _finalizeFailedOutcome();
    }

    function _failCompensation(uint8 nodeId, bytes32 evidenceHash) private {
        Compensation storage compensation = _compensations[nodeId];
        if (!compensation.opened || compensation.resolved || compensation.unresolved) {
            revert InvalidState();
        }
        compensation.unresolved = true;
        compensation.evidenceHash = evidenceHash;
        compensationPendingMask &= ~uint16(uint256(1) << nodeId);
        compensationUnresolvedMask |= uint16(uint256(1) << nodeId);
        _nodes[nodeId].status = NodeStatus.Failed;
        _recordTrace("COMP_FAIL", nodeId, evidenceHash);
        emit CompensationUnresolved(nodeId, evidenceHash);
        if (compensationPendingMask == 0) _finalizeFailedOutcome();
    }

    function _highestPendingCompensation() private view returns (uint8 highest) {
        if (compensationPendingMask == 0) revert CompensationUnavailable();
        for (uint8 i; i < nodeCount; ++i) {
            if ((compensationPendingMask & uint16(uint256(1) << i)) != 0) highest = i;
        }
    }

    function _finalizeFailedOutcome() private {
        WorkflowStatus finalStatus =
            completedMask == 0 ? WorkflowStatus.Failed : WorkflowStatus.PartiallyCompleted;
        _finalize(finalStatus);
    }

    function _closeUnfinishedJobs(NodeStatus terminalStatus, bytes32 reason) private {
        for (uint8 i; i < nodeCount; ++i) {
            Node storage node = _nodes[i];
            if (node.status == NodeStatus.Funded || node.status == NodeStatus.Submitted) {
                jobAdapter.expireFromCoordinator(node.jobId);
                reservedForJobs -= node.budget;
                available += node.budget;
            }
            if (
                node.status != NodeStatus.Completed && node.status != NodeStatus.Compensated
                    && node.status != NodeStatus.Rejected && node.status != NodeStatus.Failed
                    && node.status != NodeStatus.Expired
            ) {
                node.status = terminalStatus;
                skippedMask |= uint16(uint256(1) << i);
            }
        }
        _recordTrace("CLOSE", type(uint8).max, reason);
    }

    function _finalize(WorkflowStatus finalStatus) private {
        if (finalized) revert InvalidState();
        if (reservedForJobs != 0) revert AccountingInvariantBroken();
        uint96 refundAmount = available + reservedForCompensation;
        available = 0;
        reservedForCompensation = 0;
        refunded += refundAmount;
        finalized = true;
        _setStatus(finalStatus);
        _recordTrace("FINALIZE", type(uint8).max, bytes32(uint256(uint8(finalStatus))));
        if (refundAmount != 0) {
            paymentToken.safeTransfer(owner, refundAmount);
            emit Refunded(owner, refundAmount);
        }
        _writeReceipt(finalStatus);
        _assertAccounting();
    }

    function _writeReceipt(WorkflowStatus finalStatus) private {
        WorkflowReceiptRegistry.Receipt memory receipt = WorkflowReceiptRegistry.Receipt({
            workflow: address(this),
            owner: owner,
            totalDeposited: deposited,
            providersPaid: paidToProviders,
            compensationSpent: compensationSpent,
            protocolFees: protocolFees,
            refunded: refunded,
            completedMask: completedMask,
            failedMask: failedMask,
            compensatedMask: compensatedMask,
            finalStatus: uint8(finalStatus),
            createdBlock: createdBlock,
            finalizedBlock: uint64(block.number),
            workflowSpecificationHash: workflowSpecificationHash,
            finalEvidenceRoot: evidenceAccumulator,
            executionTraceHash: executionTraceHash
        });
        receiptRegistry.finalize(receipt);
    }

    function _recordEvidence(uint256 jobId, bytes32 deliverable, bytes32 reason) private {
        evidenceAccumulator =
            keccak256(abi.encode(evidenceAccumulator, jobId, deliverable, reason, block.number));
    }

    function _recordTrace(bytes32 action, uint8 nodeId, bytes32 detail) private {
        executionTraceHash =
            keccak256(abi.encode(executionTraceHash, action, nodeId, detail, block.number));
    }

    function _setStatus(WorkflowStatus next) private {
        WorkflowStatus previous = status;
        status = next;
        emit WorkflowStatusChanged(previous, next);
    }

    function _requireNotPaused() private view {
        if (policyRegistry.paused()) revert EmergencyPaused();
    }

    function _assertAccounting() private view {
        if (!accountingInvariantHolds()) revert AccountingInvariantBroken();
    }
}
