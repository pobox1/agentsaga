// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { FeeOnTransferUSDC } from "./mocks/FeeOnTransferUSDC.sol";
import { ReentrantUSDC } from "./mocks/ReentrantUSDC.sol";
import { PolicyRegistry } from "../src/PolicyRegistry.sol";
import { WorkflowFactory } from "../src/WorkflowFactory.sol";
import { WorkflowCoordinator } from "../src/WorkflowCoordinator.sol";
import { WorkflowReceiptRegistry } from "../src/WorkflowReceiptRegistry.sol";
import { AgentJobAdapter } from "../src/AgentJobAdapter.sol";

contract WorkflowCoordinatorTest is Test {
    uint96 internal constant NODE_BUDGET = 100e6;
    uint96 internal constant EXECUTION_BUDGET = 500e6;
    uint96 internal constant COMPENSATION_RESERVE = 100e6;
    bytes32 internal constant DAG_HASH = keccak256("vendor-onboarding-v1");

    MockUSDC internal usdc;
    PolicyRegistry internal policy;
    WorkflowFactory internal factory;
    WorkflowReceiptRegistry internal receipts;

    address internal treasury = makeAddr("treasury");
    address internal compensationProvider = makeAddr("compensationProvider");
    address internal compensationEvaluator = makeAddr("compensationEvaluator");

    function setUp() public {
        usdc = new MockUSDC();
        policy = new PolicyRegistry(address(this), treasury, address(usdc));
        factory = new WorkflowFactory(policy);
        receipts = factory.receiptRegistry();
    }

    function testSuccessfulWorkflowProducesReceiptAndRefund() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(true);
        _fund(workflow);

        for (uint8 i; i < 5; ++i) {
            if (i == 3) workflow.approveNode(i);
            _activateSubmitComplete(workflow, i);
        }

        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Completed));
        assertTrue(workflow.finalized());
        assertEq(workflow.completedMask(), 0x1f);
        assertEq(workflow.failedMask(), 0);
        assertEq(workflow.paidToProviders(), EXECUTION_BUDGET);
        assertEq(workflow.refunded(), COMPENSATION_RESERVE);

        WorkflowReceiptRegistry.Receipt memory receipt = receipts.getReceipt(address(workflow));
        assertEq(receipt.workflow, address(workflow));
        assertEq(receipt.totalDeposited, EXECUTION_BUDGET + COMPENSATION_RESERVE);
        assertEq(receipt.providersPaid, EXECUTION_BUDGET);
        assertEq(receipt.refunded, COMPENSATION_RESERVE);
        assertEq(receipt.completedMask, 0x1f);
        assertEq(receipt.paymentToken, address(usdc));
        assertEq(receipt.nodeCount, 5);
        assertEq(receipt.skippedMask, 0);
        assertEq(receipt.compensationUnresolvedMask, 0);
        assertEq(receipt.dagSpecificationHash, DAG_HASH);
        assertEq(receipt.policyVersion, 1);
        assertGt(receipt.globalDeadline, block.timestamp);
        assertEq(receipt.configuredCompensationReserve, COMPENSATION_RESERVE);
        assertTrue(receipt.evidenceAccumulator != bytes32(0));
        assertTrue(receipt.executionTraceHash != bytes32(0));
    }

    function testMiddleFailureSkipsDescendantsAndCompensatesInReverseOrder() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(true);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        _activateSubmitComplete(workflow, 1);

        workflow.activateNode(2);
        AgentJobAdapter adapter = workflow.jobAdapter();
        WorkflowCoordinator.Node memory risk = workflow.getNode(2);
        vm.prank(risk.provider);
        adapter.submit(risk.jobId, keccak256("risk-rejected-evidence"));
        vm.prank(risk.evaluator);
        adapter.reject(risk.jobId, keccak256("COUNTERPARTY_RISK_HIGH"));

        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Compensating));
        assertEq(workflow.failedMask(), 0x04);
        assertEq(workflow.skippedMask(), 0x18);
        assertEq(workflow.compensationPendingMask(), 0x03);
        assertEq(uint8(workflow.getNode(3).status), uint8(WorkflowCoordinator.NodeStatus.Skipped));

        vm.expectRevert(WorkflowCoordinator.CompensationOrderViolation.selector);
        workflow.openNextCompensation(
            0, compensationProvider, compensationEvaluator, uint48(block.timestamp + 1 days)
        );

        _openAndCompleteCompensation(workflow, 1, keccak256("undo-document-side-effect"));
        _openAndCompleteCompensation(workflow, 0, keccak256("undo-research-side-effect"));

        assertEq(
            uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.PartiallyCompleted)
        );
        assertTrue(workflow.finalized());
        assertEq(workflow.compensatedMask(), 0x03);
        assertEq(workflow.compensationSpent(), 50e6);
        assertEq(workflow.paidToProviders(), 200e6);
        assertEq(workflow.refunded(), 350e6);

        WorkflowReceiptRegistry.Receipt memory receipt = receipts.getReceipt(address(workflow));
        assertEq(receipt.failedMask, 0x04);
        assertEq(receipt.compensatedMask, 0x03);
        assertEq(receipt.compensationSpent, 50e6);
    }

    function testPrematureChildActivationReverts() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        vm.expectRevert(WorkflowCoordinator.DependencyNotSatisfied.selector);
        workflow.activateNode(1);
    }

    function testHumanApprovalRequired() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(true);
        _fund(workflow);
        for (uint8 i; i < 3; ++i) {
            _activateSubmitComplete(workflow, i);
        }
        vm.expectRevert(WorkflowCoordinator.HumanApprovalRequired.selector);
        workflow.activateNode(3);
        workflow.approveNode(3);
        workflow.activateNode(3);
    }

    function testSelfDependencyAndForwardDependencyRejected() public {
        WorkflowCoordinator.NodeInput[] memory nodes = _linearNodes(false);
        nodes[1].dependencyMask = 0x02;
        vm.expectRevert(WorkflowCoordinator.InvalidGraph.selector);
        _create(nodes, EXECUTION_BUDGET, COMPENSATION_RESERVE);

        nodes = _linearNodes(false);
        nodes[1].dependencyMask = 0x04;
        vm.expectRevert(WorkflowCoordinator.InvalidGraph.selector);
        _create(nodes, EXECUTION_BUDGET, COMPENSATION_RESERVE);
    }

    function testBudgetOverallocationRejected() public {
        WorkflowCoordinator.NodeInput[] memory nodes = _linearNodes(false);
        nodes[4].budget = 101e6;
        vm.expectRevert(WorkflowCoordinator.InvalidGraph.selector);
        _create(nodes, EXECUTION_BUDGET, COMPENSATION_RESERVE);
    }

    function testNoDoublePaymentOrFinalization() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        for (uint8 i; i < 5; ++i) {
            if (i == 3) workflow.approveNode(i);
            _activateSubmitComplete(workflow, i);
        }

        WorkflowCoordinator.Node memory last = workflow.getNode(4);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(last.evaluator);
        vm.expectRevert(AgentJobAdapter.InvalidState.selector);
        adapter.complete(last.jobId, keccak256("again"));

        vm.expectRevert(WorkflowCoordinator.InvalidDeadline.selector);
        workflow.expireWorkflow();
    }

    function testEmergencyPauseBlocksFundingAndActivation() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        policy.setPaused(true);
        usdc.mint(address(this), workflow.totalBudget());
        usdc.approve(address(workflow), workflow.totalBudget());
        vm.expectRevert(WorkflowCoordinator.EmergencyPaused.selector);
        workflow.fund();

        policy.setPaused(false);
        workflow.fund();
        policy.setPaused(true);
        vm.expectRevert(WorkflowCoordinator.EmergencyPaused.selector);
        workflow.activateNode(0);
    }

    function testPauseBlocksCreationButAllowsSubmittedCompletion() public {
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        WorkflowCoordinator workflow = _create(nodes, NODE_BUDGET, 0);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(node.provider);
        adapter.submit(node.jobId, keccak256("submitted-before-pause"));

        policy.setPaused(true);
        vm.prank(node.evaluator);
        adapter.complete(node.jobId, keccak256("valid-during-pause"));
        assertTrue(workflow.finalized());
        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Completed));

        vm.expectRevert(WorkflowFactory.EmergencyPaused.selector);
        _create(nodes, NODE_BUDGET, 0);
    }

    function testRefundAndExpiryRemainAvailableDuringPause() public {
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        WorkflowCoordinator workflow = _create(nodes, NODE_BUDGET, 0);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        policy.setPaused(true);
        vm.warp(node.expiry);
        workflow.jobAdapter().claimRefund(node.jobId);
        assertTrue(workflow.finalized());
        assertEq(workflow.refunded(), NODE_BUDGET);
    }

    function testPolicyChangesAfterFundingCannotBlockReservedCompensation() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(true);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        _activateSubmitComplete(workflow, 1);
        _rejectRiskNode(workflow);

        PolicyRegistry.Limits memory limits = policy.limits();
        limits.maximumNodeBudget = 1e6;
        policy.setLimits(limits);
        policy.setAllowlistEnforcement(true, true);
        policy.setPaused(true);

        _openAndCompleteCompensation(workflow, 1, keccak256("snapshot-policy-1"));
        _openAndCompleteCompensation(workflow, 0, keccak256("snapshot-policy-0"));
        assertTrue(workflow.finalized());
        assertEq(workflow.compensatedMask(), 0x03);
    }

    function testManualRecoveryNeverOpensAutonomousJob() public {
        WorkflowCoordinator.NodeInput[] memory nodes = _linearNodes(false);
        nodes[0].compensationType = WorkflowCoordinator.CompensationType.ManualRecovery;
        nodes[0].compensationSpecificationHash = keccak256("manual-recovery-runbook");
        WorkflowCoordinator workflow = _create(nodes, EXECUTION_BUDGET, COMPENSATION_RESERVE);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        _activateSubmitComplete(workflow, 1);
        _rejectRiskNode(workflow);

        vm.expectRevert(WorkflowCoordinator.CompensationUnavailable.selector);
        workflow.openNextCompensation(
            0, compensationProvider, compensationEvaluator, uint48(block.timestamp + 1 days)
        );
        workflow.declareCompensationUnresolved(0, keccak256("OPERATOR_ACTION_REQUIRED"));
        assertTrue(workflow.finalized());
        assertEq(workflow.compensationUnresolvedMask(), 0x01);
        assertEq(workflow.compensationSpent(), 0);
    }

    function testMetadataBounds() public {
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        nodes[0].metadataURI = string(new bytes(2_049));
        vm.expectRevert(WorkflowCoordinator.MetadataTooLong.selector);
        _create(nodes, NODE_BUDGET, 0);

        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        vm.expectRevert(WorkflowCoordinator.MetadataTooLong.selector);
        factory.createWorkflow(
            address(usdc),
            NODE_BUDGET,
            0,
            uint48(block.timestamp + 5 days),
            DAG_HASH,
            string(new bytes(2_049)),
            keccak256("metadata-bound"),
            nodes
        );
    }

    function testMaximumSixteenNodeGraphAndAddressPrediction() public {
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](16);
        for (uint8 i; i < 16; ++i) {
            nodes[i] = _node(i, 1e6, 0, false, i == 0 ? 0 : uint16(1 << (i - 1)));
        }
        bytes32 userSalt = keccak256("predict-16");
        uint48 deadline = uint48(block.timestamp + 5 days);
        address predicted = factory.predictWorkflowAddress(
            address(this),
            0,
            address(usdc),
            16e6,
            0,
            deadline,
            DAG_HASH,
            "ipfs://sixteen",
            userSalt,
            nodes
        );
        (, WorkflowCoordinator workflow) = factory.createWorkflow(
            address(usdc), 16e6, 0, deadline, DAG_HASH, "ipfs://sixteen", userSalt, nodes
        );
        assertEq(address(workflow), predicted);
        assertEq(workflow.nodeCount(), 16);
    }

    function testFeeOnTransferTokenIsRejected() public {
        FeeOnTransferUSDC feeToken = new FeeOnTransferUSDC();
        PolicyRegistry feePolicy = new PolicyRegistry(address(this), treasury, address(feeToken));
        WorkflowFactory feeFactory = new WorkflowFactory(feePolicy);
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        (, WorkflowCoordinator workflow) = feeFactory.createWorkflow(
            address(feeToken),
            NODE_BUDGET,
            0,
            uint48(block.timestamp + 5 days),
            DAG_HASH,
            "ipfs://fee-token",
            keccak256("fee-token"),
            nodes
        );
        feeToken.mint(address(this), NODE_BUDGET);
        feeToken.approve(address(workflow), NODE_BUDGET);
        vm.expectRevert(WorkflowCoordinator.FeeOnTransferUnsupported.selector);
        workflow.fund();
    }

    function testReentrantFundingCallbackIsRejectedWithoutBreakingDeposit() public {
        ReentrantUSDC token = new ReentrantUSDC();
        policy.setPaymentToken(address(token), true);
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, NODE_BUDGET, 0, false, 0);
        (, WorkflowCoordinator workflow) = factory.createWorkflow(
            address(token),
            NODE_BUDGET,
            0,
            uint48(block.timestamp + 5 days),
            DAG_HASH,
            "ipfs://reentrancy-test",
            keccak256("reentrancy"),
            nodes
        );
        token.mint(address(this), NODE_BUDGET);
        token.approve(address(workflow), NODE_BUDGET);
        token.setTarget(address(workflow));
        workflow.fund();
        assertTrue(token.attempted());
        assertFalse(token.callbackSucceeded());
        assertEq(workflow.deposited(), NODE_BUDGET);
    }

    function testUnauthorizedProviderAndEvaluatorRejected() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.expectRevert(AgentJobAdapter.Unauthorized.selector);
        adapter.submit(node.jobId, keccak256("forged"));

        vm.prank(node.provider);
        adapter.submit(node.jobId, keccak256("real"));
        vm.expectRevert(AgentJobAdapter.Unauthorized.selector);
        adapter.complete(node.jobId, keccak256("forged-eval"));
    }

    function testJobExpiryRefundsReservationAndStopsDescendants() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        vm.warp(node.expiry);
        workflow.jobAdapter().claimRefund(node.jobId);
        assertEq(workflow.failedMask(), 0x01);
        assertEq(workflow.skippedMask(), 0x1e);
        assertTrue(workflow.finalized());
        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Failed));
        assertEq(workflow.refunded(), workflow.totalBudget());
    }

    function testUnresolvedCompensationIsRecordedAndUnusedReserveRefunded() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(true);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        _activateSubmitComplete(workflow, 1);
        _rejectRiskNode(workflow);

        workflow.declareCompensationUnresolved(1, keccak256("MANUAL_RECOVERY_REQUIRED"));
        workflow.declareCompensationUnresolved(0, keccak256("NO_PROVIDER_AVAILABLE"));

        assertTrue(workflow.finalized());
        assertEq(workflow.compensationUnresolvedMask(), 0x03);
        assertEq(workflow.compensationSpent(), 0);
        assertEq(workflow.refunded(), 400e6);
    }

    function testCancelBeforeFunding() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        workflow.cancelBeforeExecution();
        assertTrue(workflow.finalized());
        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Cancelled));
        assertEq(workflow.deposited(), 0);
        assertEq(workflow.refunded(), 0);
    }

    function testCancelAfterFundingBeforeActivationHasExactAccounting() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        uint256 ownerBalanceBefore = usdc.balanceOf(address(this));
        workflow.cancelBeforeExecution();

        assertTrue(workflow.finalized());
        assertEq(workflow.activationMask(), 0);
        assertEq(workflow.refunded(), workflow.totalBudget());
        assertEq(usdc.balanceOf(address(this)) - ownerBalanceBefore, workflow.totalBudget());
        assertEq(usdc.balanceOf(address(workflow)), 0);
        assertEq(workflow.reservedForJobs(), 0);
        assertEq(workflow.reservedForCompensation(), 0);
    }

    function testCancelAfterFirstActivationReverts() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        workflow.activateNode(0);
        assertEq(workflow.activationMask(), 0x01);
        vm.expectRevert(WorkflowCoordinator.InvalidState.selector);
        workflow.cancelBeforeExecution();
    }

    function testCancelAfterProviderSubmissionReverts() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(node.provider);
        adapter.submit(node.jobId, keccak256("submitted-work"));
        vm.expectRevert(WorkflowCoordinator.InvalidState.selector);
        workflow.cancelBeforeExecution();
    }

    function testCancelAfterRejectionReverts() public {
        WorkflowCoordinator workflow = _createLinearWorkflow(false);
        _fund(workflow);
        workflow.activateNode(0);
        WorkflowCoordinator.Node memory node = workflow.getNode(0);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(node.evaluator);
        adapter.reject(node.jobId, keccak256("rejected-before-submit"));
        vm.expectRevert(WorkflowCoordinator.InvalidState.selector);
        workflow.cancelBeforeExecution();
    }

    function testCancelDuringCompensationReverts() public {
        WorkflowCoordinator workflow = _prepareCompensatingWorkflow();
        vm.expectRevert(WorkflowCoordinator.InvalidState.selector);
        workflow.cancelBeforeExecution();
    }

    function testFundedCompensationExpiryClosesAdapterJob() public {
        WorkflowCoordinator workflow = _prepareCompensatingWorkflow();
        uint48 deadline = uint48(block.timestamp + 1 days);
        uint256 jobId = workflow.openNextCompensation(
            1, compensationProvider, compensationEvaluator, deadline
        );
        vm.warp(deadline);
        vm.expectEmit(true, false, false, true, address(workflow));
        emit WorkflowCoordinator.CompensationUnresolved(1, keccak256("COMPENSATION_EXPIRED"));
        workflow.expireCompensation(1);

        AgentJobAdapter.Job memory job = workflow.jobAdapter().getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentJobAdapter.JobStatus.Expired));
        assertEq(workflow.compensationPendingMask(), 0x01);
        assertEq(workflow.compensationUnresolvedMask(), 0x02);
        vm.expectRevert(WorkflowCoordinator.CompensationOrderViolation.selector);
        workflow.expireCompensation(1);
    }

    function testSubmittedCompensationExpiryClosesAdapterJob() public {
        WorkflowCoordinator workflow = _prepareCompensatingWorkflow();
        uint48 deadline = uint48(block.timestamp + 1 days);
        uint256 jobId = workflow.openNextCompensation(
            1, compensationProvider, compensationEvaluator, deadline
        );
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(compensationProvider);
        adapter.submit(jobId, keccak256("partial-remediation"));
        vm.warp(deadline);
        workflow.expireCompensation(1);

        AgentJobAdapter.Job memory job = workflow.jobAdapter().getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentJobAdapter.JobStatus.Expired));
        assertEq(workflow.compensationUnresolvedMask(), 0x02);
    }

    function testMultipleCompensationJobsExpireInReverseOrderWithExactAccounting() public {
        WorkflowCoordinator workflow = _prepareCompensatingWorkflow();
        uint48 firstDeadline = uint48(block.timestamp + 1 days);
        uint256 firstJob = workflow.openNextCompensation(
            1, compensationProvider, compensationEvaluator, firstDeadline
        );
        vm.warp(firstDeadline);
        workflow.expireCompensation(1);

        uint48 secondDeadline = firstDeadline + 1 days;
        uint256 secondJob = workflow.openNextCompensation(
            0, compensationProvider, compensationEvaluator, secondDeadline
        );
        vm.warp(secondDeadline);
        workflow.expireCompensation(0);

        assertTrue(workflow.finalized());
        assertEq(workflow.compensationPendingMask(), 0);
        assertEq(workflow.compensationUnresolvedMask(), 0x03);
        assertEq(workflow.compensationSpent(), 0);
        assertEq(workflow.paidToProviders(), 200e6);
        assertEq(workflow.refunded(), 400e6);
        assertEq(usdc.balanceOf(address(workflow)), 0);
        assertEq(
            uint8(workflow.jobAdapter().getJob(firstJob).status),
            uint8(AgentJobAdapter.JobStatus.Expired)
        );
        assertEq(
            uint8(workflow.jobAdapter().getJob(secondJob).status),
            uint8(AgentJobAdapter.JobStatus.Expired)
        );
    }

    function testWorkflowExpiryWaitsForLaterCompensationDeadline() public {
        WorkflowCoordinator workflow = _prepareCompensatingWorkflow();
        uint48 compensationDeadline = uint48(block.timestamp + 6 days);
        uint256 jobId = workflow.openNextCompensation(
            1, compensationProvider, compensationEvaluator, compensationDeadline
        );

        vm.warp(block.timestamp + 5 days);
        vm.expectRevert(WorkflowCoordinator.InvalidState.selector);
        workflow.expireWorkflow();
        assertEq(
            uint8(workflow.jobAdapter().getJob(jobId).status),
            uint8(AgentJobAdapter.JobStatus.Funded)
        );

        vm.warp(compensationDeadline);
        workflow.expireCompensation(1);
        workflow.expireCompensation(0);
        assertTrue(workflow.finalized());
        assertEq(workflow.compensationPendingMask(), 0);
        assertEq(workflow.compensationUnresolvedMask(), 0x03);
        assertEq(
            uint8(workflow.jobAdapter().getJob(jobId).status),
            uint8(AgentJobAdapter.JobStatus.Expired)
        );
    }

    function testFuzzSingleNodeExactAccounting(uint96 rawBudget) public {
        uint96 budget = uint96(bound(rawBudget, 1e6, 1_000e6));
        WorkflowCoordinator.NodeInput[] memory nodes = new WorkflowCoordinator.NodeInput[](1);
        nodes[0] = _node(0, budget, 0, false, 0);
        WorkflowCoordinator workflow = _create(nodes, budget, 0);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        assertEq(workflow.paidToProviders(), budget);
    }

    function _createLinearWorkflow(bool withCompensation) internal returns (WorkflowCoordinator) {
        return _create(_linearNodes(withCompensation), EXECUTION_BUDGET, COMPENSATION_RESERVE);
    }

    function _prepareCompensatingWorkflow() internal returns (WorkflowCoordinator workflow) {
        workflow = _createLinearWorkflow(true);
        _fund(workflow);
        _activateSubmitComplete(workflow, 0);
        _activateSubmitComplete(workflow, 1);
        _rejectRiskNode(workflow);
        assertEq(uint8(workflow.status()), uint8(WorkflowCoordinator.WorkflowStatus.Compensating));
        assertEq(workflow.compensationPendingMask(), 0x03);
    }

    function _linearNodes(bool withCompensation)
        internal
        view
        returns (WorkflowCoordinator.NodeInput[] memory nodes)
    {
        nodes = new WorkflowCoordinator.NodeInput[](5);
        nodes[0] = _node(0, NODE_BUDGET, withCompensation ? 20e6 : 0, false, 0);
        nodes[1] = _node(1, NODE_BUDGET, withCompensation ? 30e6 : 0, false, 0x01);
        nodes[2] = _node(2, NODE_BUDGET, 0, false, 0x02);
        nodes[3] = _node(3, NODE_BUDGET, 0, true, 0x04);
        nodes[4] = _node(4, NODE_BUDGET, 0, false, 0x08);
    }

    function _node(
        uint8 id,
        uint96 budget,
        uint96 compensationBudget,
        bool humanApproval,
        uint16 dependencies
    ) internal view returns (WorkflowCoordinator.NodeInput memory) {
        return WorkflowCoordinator.NodeInput({
            provider: address(uint160(0x1000 + id)),
            evaluator: address(uint160(0x2000 + id)),
            budget: budget,
            compensationBudget: compensationBudget,
            expiry: uint48(block.timestamp + 3 days),
            dependencyMask: dependencies,
            specificationHash: keccak256(abi.encode("node-spec", id)),
            compensationSpecificationHash: compensationBudget == 0
                ? bytes32(0)
                : keccak256(abi.encode("comp-spec", id)),
            compensationType: compensationBudget == 0
                ? WorkflowCoordinator.CompensationType.None
                : WorkflowCoordinator.CompensationType.RemediationJob,
            humanApprovalRequired: humanApproval,
            metadataURI: string(abi.encodePacked("ipfs://node-", vm.toString(id)))
        });
    }

    function _create(
        WorkflowCoordinator.NodeInput[] memory nodes,
        uint96 execution,
        uint96 compensation
    ) internal returns (WorkflowCoordinator workflow) {
        (, workflow) = factory.createWorkflow(
            address(usdc),
            execution,
            compensation,
            uint48(block.timestamp + 5 days),
            DAG_HASH,
            "ipfs://agentsaga-workflow",
            keccak256(abi.encode(nodes.length, execution, compensation)),
            nodes
        );
    }

    function _fund(WorkflowCoordinator workflow) internal {
        usdc.mint(address(this), workflow.totalBudget());
        usdc.approve(address(workflow), workflow.totalBudget());
        workflow.fund();
    }

    function _activateSubmitComplete(WorkflowCoordinator workflow, uint8 nodeId) internal {
        workflow.activateNode(nodeId);
        WorkflowCoordinator.Node memory node = workflow.getNode(nodeId);
        AgentJobAdapter adapter = workflow.jobAdapter();
        bytes32 deliverable = keccak256(abi.encode("deliverable", nodeId));
        vm.prank(node.provider);
        adapter.submit(node.jobId, deliverable);
        vm.prank(node.evaluator);
        adapter.complete(node.jobId, keccak256(abi.encode("approved", nodeId)));
    }

    function _rejectRiskNode(WorkflowCoordinator workflow) internal {
        workflow.activateNode(2);
        WorkflowCoordinator.Node memory node = workflow.getNode(2);
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(node.provider);
        adapter.submit(node.jobId, keccak256("risk-evidence"));
        vm.prank(node.evaluator);
        adapter.reject(node.jobId, keccak256("RISK_REJECTED"));
    }

    function _openAndCompleteCompensation(
        WorkflowCoordinator workflow,
        uint8 nodeId,
        bytes32 deliverable
    ) internal {
        uint256 jobId = workflow.openNextCompensation(
            nodeId, compensationProvider, compensationEvaluator, uint48(block.timestamp + 1 days)
        );
        AgentJobAdapter adapter = workflow.jobAdapter();
        vm.prank(compensationProvider);
        adapter.submit(jobId, deliverable);
        vm.prank(compensationEvaluator);
        adapter.complete(jobId, keccak256("COMPENSATION_APPROVED"));
    }
}
