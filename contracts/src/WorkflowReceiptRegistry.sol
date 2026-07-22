// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract WorkflowReceiptRegistry {
    struct Receipt {
        address workflow;
        address owner;
        uint96 totalDeposited;
        uint96 providersPaid;
        uint96 compensationSpent;
        uint96 protocolFees;
        uint96 refunded;
        uint16 completedMask;
        uint16 failedMask;
        uint16 compensatedMask;
        uint8 finalStatus;
        uint64 createdBlock;
        uint64 finalizedBlock;
        bytes32 workflowSpecificationHash;
        bytes32 finalEvidenceRoot;
        bytes32 executionTraceHash;
    }

    error Unauthorized();
    error AlreadyRegistered();
    error AlreadyFinalized();

    address public immutable factory;
    mapping(address workflow => bool registered) public isRegistered;
    mapping(address workflow => Receipt receipt) private _receipts;

    event WorkflowRegistered(address indexed workflow);
    event WorkflowReceiptFinalized(
        address indexed workflow,
        address indexed owner,
        uint8 finalStatus,
        bytes32 finalEvidenceRoot
    );

    constructor(address workflowFactory) {
        factory = workflowFactory;
    }

    function registerWorkflow(address workflow) external {
        if (msg.sender != factory) revert Unauthorized();
        if (isRegistered[workflow]) revert AlreadyRegistered();
        isRegistered[workflow] = true;
        emit WorkflowRegistered(workflow);
    }

    function getReceipt(address workflow) external view returns (Receipt memory) {
        return _receipts[workflow];
    }

    function finalize(Receipt calldata receipt) external {
        if (!isRegistered[msg.sender] || receipt.workflow != msg.sender) revert Unauthorized();
        if (_receipts[msg.sender].finalizedBlock != 0) revert AlreadyFinalized();
        _receipts[msg.sender] = receipt;
        emit WorkflowReceiptFinalized(
            msg.sender, receipt.owner, receipt.finalStatus, receipt.finalEvidenceRoot
        );
    }
}

