// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { PolicyRegistry } from "../src/PolicyRegistry.sol";
import { WorkflowFactory } from "../src/WorkflowFactory.sol";
import { WorkflowCoordinator } from "../src/WorkflowCoordinator.sol";
import { WorkflowReceiptRegistry } from "../src/WorkflowReceiptRegistry.sol";
import { AgentJobAdapter } from "../src/AgentJobAdapter.sol";

contract WorkflowHandler is Test {
    WorkflowCoordinator public immutable workflow;
    AgentJobAdapter public immutable adapter;

    constructor(WorkflowCoordinator target) {
        workflow = target;
        adapter = target.jobAdapter();
    }

    function activate(uint8 rawNodeId) external {
        uint8 nodeId = rawNodeId % workflow.nodeCount();
        WorkflowCoordinator.Node memory node = workflow.getNode(nodeId);
        if (node.status == WorkflowCoordinator.NodeStatus.Ready && !workflow.finalized()) {
            workflow.activateNode(nodeId);
        }
    }

    function submit(uint8 rawNodeId, bytes32 deliverable) external {
        uint8 nodeId = rawNodeId % workflow.nodeCount();
        WorkflowCoordinator.Node memory node = workflow.getNode(nodeId);
        if (node.status == WorkflowCoordinator.NodeStatus.Funded && deliverable != bytes32(0)) {
            vm.prank(node.provider);
            adapter.submit(node.jobId, deliverable);
        }
    }

    function evaluate(uint8 rawNodeId, bool approve, bytes32 reason) external {
        uint8 nodeId = rawNodeId % workflow.nodeCount();
        WorkflowCoordinator.Node memory node = workflow.getNode(nodeId);
        if (node.status != WorkflowCoordinator.NodeStatus.Submitted) return;
        vm.prank(node.evaluator);
        if (approve) adapter.complete(node.jobId, reason);
        else adapter.reject(node.jobId, reason);
    }
}

contract WorkflowInvariantTest is StdInvariant, Test {
    MockUSDC internal usdc;
    WorkflowCoordinator internal workflow;
    WorkflowReceiptRegistry internal receipts;

    function setUp() public {
        usdc = new MockUSDC();
        PolicyRegistry policy =
            new PolicyRegistry(address(this), makeAddr("treasury"), address(usdc));
        WorkflowFactory factory = new WorkflowFactory(policy);
        receipts = factory.receiptRegistry();

        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](2);
        nodes[0] = _node(0, 0);
        nodes[1] = _node(1, 0x01);
        (, workflow) = factory.createWorkflow(
            address(usdc),
            20e6,
            0,
            uint48(block.timestamp + 30 days),
            keccak256("invariant-dag"),
            "ipfs://invariant-workflow",
            keccak256("invariant-salt"),
            nodes
        );
        usdc.mint(address(this), 20e6);
        usdc.approve(address(workflow), 20e6);
        workflow.fund();

        WorkflowHandler handler = new WorkflowHandler(workflow);
        targetContract(address(handler));
    }

    function invariant_VaultAssetsAlwaysEqualRecordedLiabilities() public view {
        assertEq(
            usdc.balanceOf(address(workflow)),
            workflow.available() + workflow.reservedForJobs() + workflow.reservedForCompensation()
        );
    }

    function invariant_PaidRefundedReservedAvailableFeesNeverExceedDeposited() public view {
        uint256 accounted = uint256(workflow.available()) + workflow.reservedForJobs()
            + workflow.reservedForCompensation() + workflow.paidToProviders()
            + workflow.compensationSpent() + workflow.refunded() + workflow.protocolFees();
        assertEq(accounted, workflow.deposited());
    }

    function invariant_NodeCannotBeBothCompletedAndFailed() public view {
        assertEq(workflow.completedMask() & workflow.failedMask(), 0);
    }

    function invariant_BlockedNodeCannotReceiveFunding() public view {
        for (uint8 i; i < workflow.nodeCount(); ++i) {
            WorkflowCoordinator.Node memory node = workflow.getNode(i);
            if (node.status == WorkflowCoordinator.NodeStatus.Blocked) {
                AgentJobAdapter.Job memory job = workflow.jobAdapter().getJob(node.jobId);
                assertEq(uint8(job.status), uint8(AgentJobAdapter.JobStatus.Open));
            }
        }
    }

    function invariant_FinalReceiptExistsExactlyWhenFinalized() public view {
        WorkflowReceiptRegistry.Receipt memory receipt = receipts.getReceipt(address(workflow));
        assertEq(receipt.finalizedBlock != 0, workflow.finalized());
    }

    function invariant_TerminalWorkflowCannotContainActiveNodes() public view {
        if (!workflow.finalized()) return;
        for (uint8 i; i < workflow.nodeCount(); ++i) {
            WorkflowCoordinator.NodeStatus status = workflow.getNode(i).status;
            assertTrue(
                status != WorkflowCoordinator.NodeStatus.Ready
                    && status != WorkflowCoordinator.NodeStatus.Funded
                    && status != WorkflowCoordinator.NodeStatus.Running
                    && status != WorkflowCoordinator.NodeStatus.Submitted
                    && status != WorkflowCoordinator.NodeStatus.Compensating
            );
        }
    }

    function invariant_CompensationCannotBePaidTwice() public view {
        assertLe(workflow.compensationSpent(), 100e6);
        assertEq(
            workflow.compensatedMask() & workflow.compensationUnresolvedMask(),
            0,
            "compensation cannot be both paid and unresolved"
        );
    }

    function _node(uint8 id, uint16 dependencies)
        private
        view
        returns (WorkflowCoordinator.NodeInput memory)
    {
        return WorkflowCoordinator.NodeInput({
            provider: address(uint160(0x3000 + id)),
            evaluator: address(uint160(0x4000 + id)),
            budget: 10e6,
            compensationBudget: 0,
            expiry: uint48(block.timestamp + 20 days),
            dependencyMask: dependencies,
            specificationHash: keccak256(abi.encode("invariant-node", id)),
            compensationSpecificationHash: bytes32(0),
            compensationType: WorkflowCoordinator.CompensationType.None,
            humanApprovalRequired: false,
            metadataURI: "ipfs://invariant-node"
        });
    }
}
