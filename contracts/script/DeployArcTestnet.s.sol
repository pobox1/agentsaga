// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";
import { PolicyRegistry } from "../src/PolicyRegistry.sol";
import { WorkflowFactory } from "../src/WorkflowFactory.sol";

contract DeployArcTestnet is Script {
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    function run() external returns (PolicyRegistry policy, WorkflowFactory factory) {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong chain");
        address owner = vm.envAddress("DEPLOYMENT_OWNER");
        address treasury = vm.envAddress("DEPLOYMENT_TREASURY");
        require(owner != address(0) && treasury != address(0), "zero operator address");

        vm.startBroadcast();
        policy = new PolicyRegistry(owner, treasury, ARC_TESTNET_USDC);
        factory = new WorkflowFactory(policy);
        vm.stopBroadcast();

        require(address(factory.policyRegistry()) == address(policy), "factory policy mismatch");
        require(address(factory.receiptRegistry()) != address(0), "missing receipt registry");
        console2.log("PolicyRegistry", address(policy));
        console2.log("WorkflowFactory", address(factory));
        console2.log("WorkflowReceiptRegistry", address(factory.receiptRegistry()));
        console2.log("WorkflowCoordinator implementation", factory.workflowImplementation());
    }
}
