// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { PolicyRegistry } from "../src/PolicyRegistry.sol";
import { WorkflowFactory } from "../src/WorkflowFactory.sol";
import { WorkflowCoordinator } from "../src/WorkflowCoordinator.sol";

/// @dev The named tests provide stable deployment gas entries for `forge snapshot`.
contract WorkflowGasBenchmarkTest is Test {
    MockUSDC private usdc;
    WorkflowFactory private factory;

    function setUp() public {
        usdc = new MockUSDC();
        PolicyRegistry policy =
            new PolicyRegistry(address(this), makeAddr("treasury"), address(usdc));
        factory = new WorkflowFactory(policy);
    }

    function testGas_Deploy1Node() public {
        _deploy(1);
    }

    function testGas_Deploy5Nodes() public {
        _deploy(5);
    }

    function testGas_Deploy10Nodes() public {
        _deploy(10);
    }

    function testGas_Deploy16Nodes() public {
        _deploy(16);
    }

    function _deploy(uint8 count) private {
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](count);
        for (uint8 i; i < count; ++i) {
            nodes[i] = WorkflowCoordinator.NodeInput({
                provider: address(uint160(0x1000 + i)),
                evaluator: address(uint160(0x2000 + i)),
                budget: 1e6,
                compensationBudget: 0,
                expiry: uint48(block.timestamp + 1 days),
                dependencyMask: i == 0 ? 0 : uint16(1 << (i - 1)),
                specificationHash: keccak256(abi.encode("gas", i)),
                compensationSpecificationHash: bytes32(0),
                compensationType: WorkflowCoordinator.CompensationType.None,
                humanApprovalRequired: false,
                metadataURI: "urn:agentsaga:gas-benchmark"
            });
        }
        factory.createWorkflow(
            address(usdc),
            uint96(uint256(count) * 1e6),
            0,
            uint48(block.timestamp + 2 days),
            keccak256(abi.encode("gas-dag", count)),
            "urn:agentsaga:gas-benchmark",
            keccak256(abi.encode("gas-salt", count)),
            nodes
        );
    }
}
