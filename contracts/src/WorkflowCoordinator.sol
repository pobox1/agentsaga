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

    uint48 private constant MAX_COMPENSATION_GRACE = 7 days;

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

    struct Config {
        address owner;
        address paymentToken;
        address policyRegistry;
        address receiptRegistry;
        address treasury;
        uint64 policyVersion;
        uint48 globalDeadline;
        uint96 totalBudget;
        uint96 executionBudget;
        uint96 configuredCompensationReserve;
        uint96 humanApprovalThreshold;
        uint96 maximumNodeBudget;
        uint16 protocolFeeBps;
        uint8 nodeCount;
        uint16 allNodesMask;
        bytes32 dagSpecificationHash;
        bytes32 workflowSpecificationHash;
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
    error MetadataTooLong();
    error AlreadyInitialized();

    AgentJobAdapter public jobAdapter;
    uint64 private _createdBlock;
    bool private _initialized;

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
    mapping(uint256 jobId => JobReference jobRef) private _jobReferences;
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

    constructor() {
        _initialized = true;
    }

    function initialize() external {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != _receiptRegistry().factory()) revert Unauthorized();
        _initialized = true;
        _createdBlock = uint64(block.number);
        jobAdapter = new AgentJobAdapter(address(paymentToken()), address(this));
        status = WorkflowStatus.Draft;
        executionTraceHash =
            keccak256(abi.encodePacked("AGENTSAGA_CREATE", workflowSpecificationHash()));
    }

    function initializeNode(uint8 nodeId, NodeInput calldata input, bool approvalRequired)
        external
    {
        if (!_initialized || msg.sender != _receiptRegistry().factory()) {
            revert Unauthorized();
        }
        uint256 jobId = jobAdapter.createJob(
            input.provider,
            input.evaluator,
            input.expiry,
            input.metadataURI,
            input.specificationHash
        );
        jobAdapter.setBudget(jobId, input.budget);
        _nodes[nodeId] = Node({
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
            humanApprovalRequired: approvalRequired,
            humanApproved: false,
            metadataURI: input.metadataURI
        });
        _jobReferences[jobId] = JobReference({ nodeId: nodeId, compensation: false, exists: true });
    }

    function _arg(uint256 slot) internal view returns (bytes32 value) {
        assembly ("memory-safe") {
            extcodecopy(address(), 0, add(0x2d, mul(slot, 0x20)), 0x20)
            value := mload(0)
        }
    }

    function owner() public view returns (address) {
        return address(uint160(uint256(_arg(0))));
    }

    function paymentToken() public view returns (IERC20) {
        return IERC20(address(uint160(uint256(_arg(1)))));
    }

    function _policyRegistry() internal view returns (PolicyRegistry) {
        return PolicyRegistry(address(uint160(uint256(_arg(2)))));
    }

    function _receiptRegistry() internal view returns (WorkflowReceiptRegistry) {
        return WorkflowReceiptRegistry(address(uint160(uint256(_arg(3)))));
    }

    function _treasury() internal view returns (address) {
        return address(uint160(uint256(_arg(4))));
    }

    function _policyVersion() internal view returns (uint64) {
        return uint64(uint256(_arg(5)));
    }

    function _globalDeadline() internal view returns (uint48) {
        return uint48(uint256(_arg(6)));
    }

    function totalBudget() public view returns (uint96) {
        return uint96(uint256(_arg(7)));
    }

    function _executionBudget() internal view returns (uint96) {
        return uint96(uint256(_arg(8)));
    }

    function _configuredCompensationReserve() internal view returns (uint96) {
        return uint96(uint256(_arg(9)));
    }

    function _maximumNodeBudget() internal view returns (uint96) {
        return uint96(uint256(_arg(11)));
    }

    function _protocolFeeBps() internal view returns (uint16) {
        return uint16(uint256(_arg(12)));
    }

    function nodeCount() public view returns (uint8) {
        return uint8(uint256(_arg(13)));
    }

    function _allNodesMask() internal view returns (uint16) {
        return uint16(uint256(_arg(14)));
    }

    function _dagSpecificationHash() internal view returns (bytes32) {
        return _arg(15);
    }

    function workflowSpecificationHash() public view returns (bytes32) {
        return _arg(16);
    }

    modifier onlyOwner() {
        if (msg.sender != owner()) revert Unauthorized();
        _;
    }

    modifier onlyAdapter() {
        if (msg.sender != address(jobAdapter)) revert Unauthorized();
        _;
    }

    function getNode(uint8 nodeId) external view returns (Node memory) {
        if (nodeId >= nodeCount()) revert InvalidNode();
        return _nodes[nodeId];
    }

    function fund() external onlyOwner nonReentrant {
        _requireNotPaused();
        if (status != WorkflowStatus.Draft) revert InvalidState();
        IERC20 token = paymentToken();
        uint96 budget = totalBudget();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), budget);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != budget) revert FeeOnTransferUnsupported();

        deposited = budget;
        available = _executionBudget();
        reservedForCompensation = _configuredCompensationReserve();
        _setStatus(WorkflowStatus.Funded);
        _setStatus(WorkflowStatus.Active);
        _refreshReadyNodes();
        _recordTrace("FUND", type(uint8).max, bytes32(uint256(budget)));
        emit WorkflowFunded(owner(), budget);
        _assertAccounting();
    }

    function approveNode(uint8 nodeId) external onlyOwner {
        if (nodeId >= nodeCount()) revert InvalidNode();
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
        if (nodeId >= nodeCount()) revert InvalidNode();
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
        JobReference memory jobRef = _jobReferences[jobId];
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
        JobReference memory jobRef = _jobReferences[jobId];
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
        JobReference memory jobRef = _jobReferences[jobId];
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
        JobReference memory jobRef = _jobReferences[jobId];
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
        if (status != WorkflowStatus.Compensating) {
            revert InvalidState();
        }
        if (nodeId >= nodeCount() || provider == address(0) || evaluator == address(0)) {
            revert InvalidNode();
        }
        if (nodeId != _highestPendingCompensation()) revert CompensationOrderViolation();
        if (
            compensationDeadline <= block.timestamp
                || compensationDeadline > _globalDeadline() + MAX_COMPENSATION_GRACE
        ) revert InvalidDeadline();

        Compensation storage compensation = _compensations[nodeId];
        if (_nodes[nodeId].compensationType != CompensationType.RemediationJob) {
            revert CompensationUnavailable();
        }
        if (compensation.opened || compensation.resolved || compensation.unresolved) {
            revert CompensationUnavailable();
        }
        // Recovery policy is snapshotted at workflow creation. Registry changes after funding
        // cannot strand funds reserved for a previously accepted workflow.
        if (compensation.budget == 0 || compensation.budget > _maximumNodeBudget()) {
            revert InvalidBudget();
        }
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
        _jobReferences[jobId] = JobReference({ nodeId: nodeId, compensation: true, exists: true });
        _nodes[nodeId].status = NodeStatus.Compensating;
        _recordTrace("COMP_OPEN", nodeId, bytes32(jobId));
        emit CompensationJobOpened(nodeId, jobId, provider, compensation.budget);
    }

    function declareCompensationUnresolved(uint8 nodeId, bytes32 evidenceHash) external onlyOwner {
        if (status != WorkflowStatus.Compensating || nodeId >= nodeCount()) revert InvalidState();
        if (nodeId != _highestPendingCompensation()) revert CompensationOrderViolation();
        Compensation storage compensation = _compensations[nodeId];
        if (compensation.opened || compensation.resolved || compensation.unresolved) {
            revert CompensationUnavailable();
        }
        if (evidenceHash == bytes32(0)) revert InvalidNode();
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
        if (block.timestamp < _globalDeadline()) revert InvalidDeadline();
        if (finalized) revert InvalidState();
        _closeUnfinishedJobs(NodeStatus.Expired, keccak256("WORKFLOW_EXPIRED"));
        _finalize(WorkflowStatus.Expired);
    }

    function _accountingInvariantHolds() internal view returns (bool) {
        uint256 accounted = uint256(available) + reservedForJobs + reservedForCompensation
            + paidToProviders + compensationSpent + refunded + protocolFees;
        return accounted == deposited
            && paymentToken().balanceOf(address(this))
                == uint256(available) + reservedForJobs + reservedForCompensation;
    }

    function _completeNode(uint8 nodeId, uint256 jobId) private {
        Node storage node = _nodes[nodeId];
        if (node.status != NodeStatus.Submitted) revert InvalidState();
        node.status = NodeStatus.Completed;
        uint16 bit = uint16(uint256(1) << nodeId);
        completedMask |= bit;
        reservedForJobs -= node.budget;

        uint96 fee = uint96((uint256(node.budget) * _protocolFeeBps()) / 10_000);
        uint96 providerPayment = node.budget - fee;
        paidToProviders += providerPayment;
        protocolFees += fee;
        if (providerPayment != 0) paymentToken().safeTransfer(node.provider, providerPayment);
        if (fee != 0) paymentToken().safeTransfer(_treasury(), fee);

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
        for (uint8 pass; pass < nodeCount(); ++pass) {
            bool changed;
            uint16 stopMask = failedMask | skippedMask;
            for (uint8 i; i < nodeCount(); ++i) {
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
        for (uint8 i; i < nodeCount(); ++i) {
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
        if (completedMask == _allNodesMask()) {
            _finalize(WorkflowStatus.Completed);
            return;
        }
        if (failedMask != 0 && _executionIsTerminal()) _planCompensation();
    }

    function _executionIsTerminal() private view returns (bool) {
        for (uint8 i; i < nodeCount(); ++i) {
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
        for (uint8 i; i < nodeCount(); ++i) {
            uint16 bit = uint16(uint256(1) << i);
            Node storage node = _nodes[i];
            if ((completedMask & bit) != 0 && node.compensationType != CompensationType.None) {
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
        paymentToken().safeTransfer(compensation.provider, compensation.budget);
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
        for (uint8 i; i < nodeCount(); ++i) {
            if ((compensationPendingMask & uint16(uint256(1) << i)) != 0) highest = i;
        }
    }

    function _finalizeFailedOutcome() private {
        WorkflowStatus finalStatus =
            completedMask == 0 ? WorkflowStatus.Failed : WorkflowStatus.PartiallyCompleted;
        _finalize(finalStatus);
    }

    function _closeUnfinishedJobs(NodeStatus terminalStatus, bytes32 reason) private {
        for (uint8 i; i < nodeCount(); ++i) {
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
            paymentToken().safeTransfer(owner(), refundAmount);
            emit Refunded(owner(), refundAmount);
        }
        _writeReceipt(finalStatus);
        _assertAccounting();
    }

    function _writeReceipt(WorkflowStatus finalStatus) private {
        WorkflowReceiptRegistry.Receipt memory receipt = WorkflowReceiptRegistry.Receipt({
            workflow: address(this),
            owner: owner(),
            paymentToken: address(paymentToken()),
            totalDeposited: deposited,
            providersPaid: paidToProviders,
            compensationSpent: compensationSpent,
            protocolFees: protocolFees,
            refunded: refunded,
            configuredCompensationReserve: _configuredCompensationReserve(),
            completedMask: completedMask,
            failedMask: failedMask,
            skippedMask: skippedMask,
            compensatedMask: compensatedMask,
            compensationUnresolvedMask: compensationUnresolvedMask,
            nodeCount: nodeCount(),
            finalStatus: uint8(finalStatus),
            globalDeadline: _globalDeadline(),
            policyVersion: _policyVersion(),
            createdBlock: _createdBlock,
            finalizedBlock: uint64(block.number),
            dagSpecificationHash: _dagSpecificationHash(),
            workflowSpecificationHash: workflowSpecificationHash(),
            evidenceAccumulator: evidenceAccumulator,
            executionTraceHash: executionTraceHash
        });
        _receiptRegistry().finalize(receipt);
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
        if (_policyRegistry().paused()) revert EmergencyPaused();
    }

    function _assertAccounting() private view {
        if (!_accountingInvariantHolds()) revert AccountingInvariantBroken();
    }
}
