// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { PolicyRegistry } from "./PolicyRegistry.sol";
import { WorkflowCoordinator } from "./WorkflowCoordinator.sol";
import { WorkflowReceiptRegistry } from "./WorkflowReceiptRegistry.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

/// @notice Permissionless discovery and deterministic deployment for project-owned workflows.
contract WorkflowFactory {
    uint256 private constant MAX_METADATA_LENGTH = 2_048;
    error InvalidAddress();
    error EmergencyPaused();
    error InvalidBudget();
    error InvalidDeadline();
    error InvalidGraph();
    error InvalidNode();
    error MetadataTooLong();

    PolicyRegistry public immutable policyRegistry;
    WorkflowReceiptRegistry public immutable receiptRegistry;
    address public immutable workflowImplementation;
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
        workflowImplementation = address(new WorkflowCoordinator());
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
        if (policyRegistry.paused()) revert EmergencyPaused();
        uint256 nonce = ownerNonce[msg.sender]++;
        bytes32 salt = computeSalt(msg.sender, nonce, userSalt);
        bytes memory immutableArgs = _immutableArgs(
            msg.sender,
            token,
            executionBudget,
            compensationReserve,
            deadline,
            dagSpecificationHash,
            metadataURI,
            nodes.length
        );
        PolicyRegistry.Limits memory snapshot = policyRegistry.limits();
        _validateNodes(nodes, executionBudget, compensationReserve, deadline);
        workflow = WorkflowCoordinator(
            Clones.cloneDeterministicWithImmutableArgs(workflowImplementation, immutableArgs, salt)
        );
        workflow.initialize();
        for (uint8 i; i < nodes.length; ++i) {
            workflow.initializeNode(
                i,
                nodes[i],
                nodes[i].humanApprovalRequired || nodes[i].budget >= snapshot.humanApprovalThreshold
            );
        }
        receiptRegistry.registerWorkflow(address(workflow));
        workflowId = workflowCount++;
        workflowById[workflowId] = address(workflow);
        emit WorkflowCreated(
            workflowId, address(workflow), msg.sender, workflow.workflowSpecificationHash(), salt
        );
    }

    function computeSalt(address workflowOwner, uint256 nonce, bytes32 userSalt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(workflowOwner, nonce, userSalt));
    }

    function predictWorkflowAddress(
        address workflowOwner,
        uint256 nonce,
        address token,
        uint96 executionBudget,
        uint96 compensationReserve,
        uint48 deadline,
        bytes32 dagSpecificationHash,
        string calldata metadataURI,
        bytes32 userSalt,
        WorkflowCoordinator.NodeInput[] calldata nodes
    ) external view returns (address predicted) {
        bytes32 salt = computeSalt(workflowOwner, nonce, userSalt);
        bytes memory immutableArgs = _immutableArgs(
            workflowOwner,
            token,
            executionBudget,
            compensationReserve,
            deadline,
            dagSpecificationHash,
            metadataURI,
            nodes.length
        );
        predicted = Clones.predictDeterministicAddressWithImmutableArgs(
            workflowImplementation, immutableArgs, salt, address(this)
        );
    }

    function _immutableArgs(
        address workflowOwner,
        address token,
        uint96 executionBudget,
        uint96 compensationReserve,
        uint48 deadline,
        bytes32 dagSpecificationHash,
        string calldata metadataURI,
        uint256 nodesLength
    ) internal view returns (bytes memory) {
        if (workflowOwner == address(0) || token == address(0)) {
            revert InvalidAddress();
        }
        if (executionBudget == 0) revert InvalidBudget();
        if (deadline <= block.timestamp || dagSpecificationHash == bytes32(0)) {
            revert InvalidDeadline();
        }
        if (bytes(metadataURI).length > MAX_METADATA_LENGTH) {
            revert MetadataTooLong();
        }
        uint256 total = uint256(executionBudget) + compensationReserve;
        if (total > type(uint96).max) revert InvalidAddress();
        PolicyRegistry.Limits memory snapshot = policyRegistry.validateWorkflow(
            token, uint96(total), compensationReserve, uint8(nodesLength)
        );
        WorkflowCoordinator.Config memory config;
        config.owner = workflowOwner;
        config.paymentToken = token;
        config.policyRegistry = address(policyRegistry);
        config.receiptRegistry = address(receiptRegistry);
        config.treasury = policyRegistry.treasury();
        config.policyVersion = policyRegistry.version();
        config.globalDeadline = deadline;
        config.totalBudget = uint96(total);
        config.executionBudget = executionBudget;
        config.configuredCompensationReserve = compensationReserve;
        config.humanApprovalThreshold = snapshot.humanApprovalThreshold;
        config.maximumNodeBudget = snapshot.maximumNodeBudget;
        config.protocolFeeBps = snapshot.protocolFeeBps;
        config.nodeCount = uint8(nodesLength);
        config.allNodesMask = uint16((uint256(1) << nodesLength) - 1);
        config.dagSpecificationHash = dagSpecificationHash;
        config.workflowSpecificationHash = _specificationHash(
            dagSpecificationHash,
            metadataURI,
            executionBudget,
            compensationReserve,
            deadline,
            nodesLength
        );
        return abi.encode(config);
    }

    function _specificationHash(
        bytes32 dagSpecificationHash,
        string calldata metadataURI,
        uint96 executionBudget,
        uint96 compensationReserve,
        uint48 deadline,
        uint256 nodesLength
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                dagSpecificationHash,
                keccak256(bytes(metadataURI)),
                executionBudget,
                compensationReserve,
                deadline,
                nodesLength
            )
        );
    }

    function _validateNodes(
        WorkflowCoordinator.NodeInput[] calldata nodes,
        uint96 executionBudget,
        uint96 compensationReserve,
        uint48 deadline
    ) internal view {
        uint256 serviceSum;
        uint256 compensationSum;
        uint256 roots;
        for (uint8 i; i < nodes.length; ++i) {
            WorkflowCoordinator.NodeInput calldata input = nodes[i];
            policyRegistry.validateNode(input.provider, input.evaluator, input.budget);
            if (input.provider == address(0) || input.evaluator == address(0)) {
                revert InvalidAddress();
            }
            if (input.expiry <= block.timestamp || input.expiry > deadline) {
                revert InvalidDeadline();
            }
            if (input.specificationHash == bytes32(0)) revert InvalidNode();
            if (bytes(input.metadataURI).length > MAX_METADATA_LENGTH) {
                revert MetadataTooLong();
            }
            uint16 bit = uint16(uint256(1) << i);
            uint16 priorMask = i == 0 ? 0 : uint16((uint256(1) << i) - 1);
            if ((input.dependencyMask & bit) != 0 || (input.dependencyMask & ~priorMask) != 0) {
                revert InvalidGraph();
            }
            if (input.dependencyMask == 0) ++roots;
            if (input.compensationType == WorkflowCoordinator.CompensationType.None) {
                if (
                    input.compensationBudget != 0
                        || input.compensationSpecificationHash != bytes32(0)
                ) revert InvalidBudget();
            } else if (
                input.compensationType == WorkflowCoordinator.CompensationType.RemediationJob
            ) {
                if (
                    input.compensationBudget == 0
                        || input.compensationSpecificationHash == bytes32(0)
                ) {
                    revert InvalidBudget();
                }
            } else if (
                input.compensationType == WorkflowCoordinator.CompensationType.ManualRecovery
            ) {
                if (
                    input.compensationBudget != 0
                        || input.compensationSpecificationHash == bytes32(0)
                ) {
                    revert InvalidBudget();
                }
            }
            serviceSum += input.budget;
            compensationSum += input.compensationBudget;
        }
        if (roots == 0 || serviceSum > executionBudget || compensationSum > compensationReserve) {
            revert InvalidGraph();
        }
    }
}
