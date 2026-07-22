// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { PolicyRegistry } from "./PolicyRegistry.sol";
import { WorkflowCoordinator } from "./WorkflowCoordinator.sol";
import { WorkflowReceiptRegistry } from "./WorkflowReceiptRegistry.sol";

/// @notice Permissionless discovery and deterministic deployment for project-owned workflows.
contract WorkflowFactory {
    error InvalidAddress();

    PolicyRegistry public immutable policyRegistry;
    WorkflowReceiptRegistry public immutable receiptRegistry;
    uint256 public workflowCount;
    mapping(uint256 workflowId => address workflow) public workflowById;
    mapping(address owner => uint256 nonce) public ownerNonce;

    event WorkflowCreated(
        uint256 indexed workflowId,
        address indexed workflow,
        address indexed owner,
        bytes32 workflowSpecificationHash,
        bytes32 salt
    );

    constructor(PolicyRegistry registry) {
        if (address(registry) == address(0)) revert InvalidAddress();
        policyRegistry = registry;
        receiptRegistry = new WorkflowReceiptRegistry(address(this));
    }

    function createWorkflow(
        address token,
        uint96 executionBudget,
        uint96 compensationReserve,
        uint48 deadline,
        bytes32 dagSpecificationHash,
        string calldata metadataURI,
        bytes32 userSalt,
        WorkflowCoordinator.NodeInput[] calldata nodes
    ) external returns (uint256 workflowId, WorkflowCoordinator workflow) {
        uint256 nonce = ownerNonce[msg.sender]++;
        bytes32 salt = keccak256(abi.encode(msg.sender, nonce, userSalt));
        workflow = new WorkflowCoordinator{ salt: salt }(
            msg.sender,
            token,
            policyRegistry,
            receiptRegistry,
            executionBudget,
            compensationReserve,
            deadline,
            dagSpecificationHash,
            metadataURI,
            nodes
        );
        receiptRegistry.registerWorkflow(address(workflow));
        workflowId = workflowCount++;
        workflowById[workflowId] = address(workflow);
        emit WorkflowCreated(
            workflowId, address(workflow), msg.sender, workflow.workflowSpecificationHash(), salt
        );
    }
}

