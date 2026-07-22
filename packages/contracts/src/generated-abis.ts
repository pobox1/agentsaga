// Generated from Foundry artifacts by packages/contracts/scripts/generate-abi.mjs.
// Do not edit manually. Run `pnpm contracts:generate-abi` after Solidity changes.

export const workflowFactoryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "contract PolicyRegistry"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "computeSalt",
    "inputs": [
      {
        "name": "workflowOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "userSalt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "createWorkflow",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "executionBudget",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "compensationReserve",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "deadline",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "dagSpecificationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "metadataURI",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "userSalt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nodes",
        "type": "tuple[]",
        "internalType": "struct WorkflowCoordinator.NodeInput[]",
        "components": [
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "evaluator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "budget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "expiry",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "dependencyMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "specificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationType",
            "type": "uint8",
            "internalType": "enum WorkflowCoordinator.CompensationType"
          },
          {
            "name": "humanApprovalRequired",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "workflowId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "workflow",
        "type": "address",
        "internalType": "contract WorkflowCoordinator"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerNonce",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "policyRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract PolicyRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "predictWorkflowAddress",
    "inputs": [
      {
        "name": "workflowOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "executionBudget",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "compensationReserve",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "deadline",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "dagSpecificationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "metadataURI",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "userSalt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nodes",
        "type": "tuple[]",
        "internalType": "struct WorkflowCoordinator.NodeInput[]",
        "components": [
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "evaluator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "budget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "expiry",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "dependencyMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "specificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationType",
            "type": "uint8",
            "internalType": "enum WorkflowCoordinator.CompensationType"
          },
          {
            "name": "humanApprovalRequired",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "predicted",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "receiptRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract WorkflowReceiptRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "workflowById",
    "inputs": [
      {
        "name": "workflowId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "workflow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "workflowCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "workflowImplementation",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "WorkflowCreated",
    "inputs": [
      {
        "name": "workflowId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "workflow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "workflowSpecificationHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CloneArgumentsTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Create2EmptyBytecode",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmergencyPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FailedDeployment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBudget",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidGraph",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidNode",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MetadataTooLong",
    "inputs": []
  }
] as const;

export const workflowCoordinatorAbi = [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activateNode",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activationMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approveNode",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "available",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelBeforeExecution",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "compensatedMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "compensationPendingMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "compensationSpent",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "compensationUnresolvedMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "completedMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "declareCompensationUnresolved",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deposited",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "evidenceAccumulator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executionTraceHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expireCompensation",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "expireWorkflow",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "failedMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalized",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "fund",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getNode",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct WorkflowCoordinator.Node",
        "components": [
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "evaluator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "budget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "expiry",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "dependencyMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "jobId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "specificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationType",
            "type": "uint8",
            "internalType": "enum WorkflowCoordinator.CompensationType"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum WorkflowCoordinator.NodeStatus"
          },
          {
            "name": "humanApprovalRequired",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "humanApproved",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initialize",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "initializeNode",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct WorkflowCoordinator.NodeInput",
        "components": [
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "evaluator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "budget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "expiry",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "dependencyMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "specificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "compensationType",
            "type": "uint8",
            "internalType": "enum WorkflowCoordinator.CompensationType"
          },
          {
            "name": "humanApprovalRequired",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      },
      {
        "name": "approvalRequired",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "jobAdapter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract AgentJobAdapter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nodeCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onJobCompleted",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "onJobExpired",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "onJobRejected",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "onJobSubmitted",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "openNextCompensation",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "evaluator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "compensationDeadline",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "outputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paidToProviders",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolFees",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refunded",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reservedForCompensation",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reservedForJobs",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "skippedMask",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "status",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum WorkflowCoordinator.WorkflowStatus"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalBudget",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "workflowSpecificationHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "CompensationCompleted",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "spent",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CompensationJobOpened",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "provider",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "budget",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CompensationPlanned",
    "inputs": [
      {
        "name": "pendingMask",
        "type": "uint16",
        "indexed": true,
        "internalType": "uint16"
      },
      {
        "name": "reservedBudget",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CompensationUnresolved",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeActivated",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "budget",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeApproved",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "approver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeCompleted",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "provider",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "paid",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "fee",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeReady",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeRejected",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeSkipped",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "failedAncestor",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NodeSubmitted",
    "inputs": [
      {
        "name": "nodeId",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refunded",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorkflowFunded",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorkflowStatusChanged",
    "inputs": [
      {
        "name": "previous",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum WorkflowCoordinator.WorkflowStatus"
      },
      {
        "name": "current",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum WorkflowCoordinator.WorkflowStatus"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AccountingInvariantBroken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyApproved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CompensationOrderViolation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CompensationUnavailable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DependencyNotSatisfied",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmergencyPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeeOnTransferUnsupported",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HumanApprovalRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBudget",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidGraph",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidNode",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MetadataTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;

export const agentJobAdapterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "workflowCoordinator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_DESCRIPTION_LENGTH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimRefund",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "complete",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "coordinator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createJob",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "evaluator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expiredAt",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "description",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "specificationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "expireFromCoordinator",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fund",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expectedBudget",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getJob",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AgentJobAdapter.Job",
        "components": [
          {
            "name": "client",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "evaluator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "budget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "expiredAt",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum AgentJobAdapter.JobStatus"
          },
          {
            "name": "specificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deliverableHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evaluationReason",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextJobId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reject",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setBudget",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submit",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "BudgetSet",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobCompleted",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "evaluator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobCreated",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "provider",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "evaluator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "expiredAt",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      },
      {
        "name": "specificationHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobExpired",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobFunded",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobRejected",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "rejector",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobSubmitted",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "provider",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BudgetMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyCommitment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidExpiry",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MetadataTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;

export const receiptRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "workflowFactory",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "factory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalize",
    "inputs": [
      {
        "name": "receipt",
        "type": "tuple",
        "internalType": "struct WorkflowReceiptRegistry.Receipt",
        "components": [
          {
            "name": "workflow",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "paymentToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "totalDeposited",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "providersPaid",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationSpent",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFees",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "refunded",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "configuredCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "completedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "failedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "skippedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "compensatedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "compensationUnresolvedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "nodeCount",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "finalStatus",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "globalDeadline",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "policyVersion",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "createdBlock",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizedBlock",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "dagSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "workflowSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceAccumulator",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "executionTraceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getReceipt",
    "inputs": [
      {
        "name": "workflow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct WorkflowReceiptRegistry.Receipt",
        "components": [
          {
            "name": "workflow",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "paymentToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "totalDeposited",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "providersPaid",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "compensationSpent",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFees",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "refunded",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "configuredCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "completedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "failedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "skippedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "compensatedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "compensationUnresolvedMask",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "nodeCount",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "finalStatus",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "globalDeadline",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "policyVersion",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "createdBlock",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizedBlock",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "dagSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "workflowSpecificationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceAccumulator",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "executionTraceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isRegistered",
    "inputs": [
      {
        "name": "workflow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "registered",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registerWorkflow",
    "inputs": [
      {
        "name": "workflow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "WorkflowReceiptFinalized",
    "inputs": [
      {
        "name": "workflow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "finalStatus",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "evidenceAccumulator",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorkflowRegistered",
    "inputs": [
      {
        "name": "workflow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyFinalized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyRegistered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;

export const policyRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialTreasury",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "arcUsdc",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowedEvaluator",
    "inputs": [
      {
        "name": "evaluator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedPaymentToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedProvider",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enforceEvaluatorAllowlist",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enforceProviderAllowlist",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "limits",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PolicyRegistry.Limits",
        "components": [
          {
            "name": "maximumTotalBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "maximumNodeBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "minimumCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "humanApprovalThreshold",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFeeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maximumNodes",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAllowlistEnforcement",
    "inputs": [
      {
        "name": "providers",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "evaluators",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setEvaluator",
    "inputs": [
      {
        "name": "evaluator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLimits",
    "inputs": [
      {
        "name": "next",
        "type": "tuple",
        "internalType": "struct PolicyRegistry.Limits",
        "components": [
          {
            "name": "maximumTotalBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "maximumNodeBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "minimumCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "humanApprovalThreshold",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFeeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maximumNodes",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "next",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaymentToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setProvider",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTreasury",
    "inputs": [
      {
        "name": "next",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validateNode",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "evaluator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "budget",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validateWorkflow",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "totalBudget",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "compensationReserve",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "nodeCount",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "snapshot",
        "type": "tuple",
        "internalType": "struct PolicyRegistry.Limits",
        "components": [
          {
            "name": "maximumTotalBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "maximumNodeBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "minimumCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "humanApprovalThreshold",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFeeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maximumNodes",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "version",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AllowlistEnforcementUpdated",
    "inputs": [
      {
        "name": "providers",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "evaluators",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EvaluatorUpdated",
    "inputs": [
      {
        "name": "evaluator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LimitsUpdated",
    "inputs": [
      {
        "name": "version",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "limits",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct PolicyRegistry.Limits",
        "components": [
          {
            "name": "maximumTotalBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "maximumNodeBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "minimumCompensationReserve",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "humanApprovalThreshold",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "protocolFeeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maximumNodes",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PauseUpdated",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentTokenUpdated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProviderUpdated",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryUpdated",
    "inputs": [
      {
        "name": "treasury",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BudgetOutOfBounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CompensationReserveTooLow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EvaluatorNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPolicy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NodeBudgetOutOfBounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NodeCountOutOfBounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PolicyPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ProviderNotAllowed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenNotAllowed",
    "inputs": []
  }
] as const;

export const workflowStatusLabels = [
  "Draft",
  "Funded",
  "Active",
  "PartiallyCompleted",
  "Compensating",
  "Completed",
  "Failed",
  "Cancelled",
  "Expired"
] as const;

export const nodeStatusLabels = [
  "Blocked",
  "Ready",
  "Funded",
  "Running",
  "Submitted",
  "Completed",
  "Rejected",
  "Failed",
  "Skipped",
  "Compensating",
  "Compensated",
  "Expired"
] as const;

export const compensationTypeLabels = [
  "None",
  "RemediationJob",
  "ManualRecovery"
] as const;

