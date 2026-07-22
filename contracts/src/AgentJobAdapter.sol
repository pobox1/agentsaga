// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAgentJobCallback } from "./interfaces/IAgentJobCallback.sol";

/// @notice Observable single-job lifecycle equivalent to the ERC-8183 core states.
/// @dev Funds remain in the workflow vault. Only the coordinator can create/fund jobs, so a
/// provider cannot renegotiate a funded workflow budget behind the vault's accounting.
contract AgentJobAdapter {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint96 budget;
        uint48 expiredAt;
        JobStatus status;
        bytes32 specificationHash;
        bytes32 deliverableHash;
        bytes32 evaluationReason;
        string description;
    }

    error Unauthorized();
    error InvalidAddress();
    error InvalidExpiry();
    error InvalidState();
    error BudgetMismatch();
    error EmptyCommitment();

    address public immutable coordinator;
    address public immutable paymentToken;
    uint256 public nextJobId;
    mapping(uint256 jobId => Job job) private _jobs;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint48 expiredAt,
        bytes32 specificationHash
    );
    event BudgetSet(uint256 indexed jobId, uint96 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint96 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverableHash);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);

    constructor(address token, address workflowCoordinator) {
        if (token == address(0) || workflowCoordinator == address(0)) revert InvalidAddress();
        paymentToken = token;
        coordinator = workflowCoordinator;
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert Unauthorized();
        _;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function createJob(
        address provider,
        address evaluator,
        uint48 expiredAt,
        string calldata description,
        bytes32 specificationHash
    ) external onlyCoordinator returns (uint256 jobId) {
        if (provider == address(0) || evaluator == address(0)) {
            revert InvalidAddress();
        }
        if (expiredAt <= block.timestamp) revert InvalidExpiry();
        if (specificationHash == bytes32(0)) revert EmptyCommitment();
        jobId = nextJobId++;
        _jobs[jobId] = Job({
            client: coordinator,
            provider: provider,
            evaluator: evaluator,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            specificationHash: specificationHash,
            deliverableHash: bytes32(0),
            evaluationReason: bytes32(0),
            description: description
        });
        emit JobCreated(jobId, coordinator, provider, evaluator, expiredAt, specificationHash);
    }

    function setBudget(uint256 jobId, uint96 amount) external onlyCoordinator {
        Job storage job = _jobs[jobId];
        if (job.status != JobStatus.Open || amount == 0) revert InvalidState();
        job.budget = amount;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, uint96 expectedBudget) external onlyCoordinator {
        Job storage job = _jobs[jobId];
        if (job.status != JobStatus.Open || job.budget != expectedBudget) revert BudgetMismatch();
        job.status = JobStatus.Funded;
        emit JobFunded(jobId, coordinator, expectedBudget);
    }

    function submit(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();
        if (job.status != JobStatus.Funded) revert InvalidState();
        if (deliverableHash == bytes32(0)) revert EmptyCommitment();
        job.deliverableHash = deliverableHash;
        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, msg.sender, deliverableHash);
        IAgentJobCallback(coordinator).onJobSubmitted(jobId, deliverableHash);
    }

    function complete(uint256 jobId, bytes32 reason) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != JobStatus.Submitted) revert InvalidState();
        job.evaluationReason = reason;
        job.status = JobStatus.Completed;
        emit JobCompleted(jobId, msg.sender, reason);
        IAgentJobCallback(coordinator).onJobCompleted(jobId, job.deliverableHash, reason);
    }

    function reject(uint256 jobId, bytes32 reason) external {
        Job storage job = _jobs[jobId];
        bool openCancellation = job.status == JobStatus.Open && msg.sender == coordinator;
        bool evaluatorRejection =
            (job.status == JobStatus.Funded || job.status == JobStatus.Submitted)
                && msg.sender == job.evaluator;
        if (!openCancellation && !evaluatorRejection) revert Unauthorized();
        job.evaluationReason = reason;
        job.status = JobStatus.Rejected;
        emit JobRejected(jobId, msg.sender, reason);
        if (!openCancellation) IAgentJobCallback(coordinator).onJobRejected(jobId, reason);
    }

    function claimRefund(uint256 jobId) external {
        Job storage job = _jobs[jobId];
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidState();
        }
        if (block.timestamp < job.expiredAt) revert InvalidExpiry();
        job.status = JobStatus.Expired;
        emit JobExpired(jobId);
        IAgentJobCallback(coordinator).onJobExpired(jobId);
    }

    /// @dev Used during global workflow expiry. The coordinator performs the matching vault update.
    function expireFromCoordinator(uint256 jobId) external onlyCoordinator {
        Job storage job = _jobs[jobId];
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidState();
        }
        job.status = JobStatus.Expired;
        emit JobExpired(jobId);
    }
}

