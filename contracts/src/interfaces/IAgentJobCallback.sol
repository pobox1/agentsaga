// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IAgentJobCallback {
    function onJobSubmitted(uint256 jobId, bytes32 deliverableHash) external;
    function onJobCompleted(uint256 jobId, bytes32 deliverableHash, bytes32 reason) external;
    function onJobRejected(uint256 jobId, bytes32 reason) external;
    function onJobExpired(uint256 jobId) external;
}

