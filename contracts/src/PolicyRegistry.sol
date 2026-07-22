// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Bounded, operator-owned policy. It is deliberately not governance.
contract PolicyRegistry is Ownable {
    error InvalidPolicy();
    error PolicyPaused();
    error TokenNotAllowed();
    error BudgetOutOfBounds();
    error NodeBudgetOutOfBounds();
    error NodeCountOutOfBounds();
    error CompensationReserveTooLow();
    error ProviderNotAllowed();
    error EvaluatorNotAllowed();

    struct Limits {
        uint96 maximumTotalBudget;
        uint96 maximumNodeBudget;
        uint96 minimumCompensationReserve;
        uint96 humanApprovalThreshold;
        uint16 protocolFeeBps;
        uint8 maximumNodes;
    }

    Limits private _limits;
    address public treasury;
    bool public paused;
    bool public enforceProviderAllowlist;
    bool public enforceEvaluatorAllowlist;
    uint64 public version;

    mapping(address token => bool allowed) public allowedPaymentToken;
    mapping(address provider => bool allowed) public allowedProvider;
    mapping(address evaluator => bool allowed) public allowedEvaluator;

    event LimitsUpdated(uint64 indexed version, Limits limits);
    event TreasuryUpdated(address indexed treasury);
    event PaymentTokenUpdated(address indexed token, bool allowed);
    event ProviderUpdated(address indexed provider, bool allowed);
    event EvaluatorUpdated(address indexed evaluator, bool allowed);
    event AllowlistEnforcementUpdated(bool providers, bool evaluators);
    event PauseUpdated(bool paused);

    constructor(address initialOwner, address initialTreasury, address arcUsdc)
        Ownable(initialOwner)
    {
        if (initialTreasury == address(0) || arcUsdc == address(0)) revert InvalidPolicy();
        treasury = initialTreasury;
        allowedPaymentToken[arcUsdc] = true;
        _limits = Limits({
            maximumTotalBudget: 1_000_000e6,
            maximumNodeBudget: 250_000e6,
            minimumCompensationReserve: 0,
            humanApprovalThreshold: 10_000e6,
            protocolFeeBps: 0,
            maximumNodes: 16
        });
        version = 1;
    }

    function limits() external view returns (Limits memory) {
        return _limits;
    }

    function setLimits(Limits calldata next) external onlyOwner {
        if (
            next.maximumTotalBudget == 0 || next.maximumNodeBudget == 0
                || next.maximumNodeBudget > next.maximumTotalBudget || next.maximumNodes == 0
                || next.maximumNodes > 16 || next.protocolFeeBps > 1_000
        ) revert InvalidPolicy();
        _limits = next;
        unchecked {
            ++version;
        }
        emit LimitsUpdated(version, next);
    }

    function setTreasury(address next) external onlyOwner {
        if (next == address(0)) revert InvalidPolicy();
        treasury = next;
        emit TreasuryUpdated(next);
    }

    function setPaymentToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidPolicy();
        allowedPaymentToken[token] = allowed;
        emit PaymentTokenUpdated(token, allowed);
    }

    function setProvider(address provider, bool allowed) external onlyOwner {
        if (provider == address(0)) revert InvalidPolicy();
        allowedProvider[provider] = allowed;
        emit ProviderUpdated(provider, allowed);
    }

    function setEvaluator(address evaluator, bool allowed) external onlyOwner {
        if (evaluator == address(0)) revert InvalidPolicy();
        allowedEvaluator[evaluator] = allowed;
        emit EvaluatorUpdated(evaluator, allowed);
    }

    function setAllowlistEnforcement(bool providers, bool evaluators) external onlyOwner {
        enforceProviderAllowlist = providers;
        enforceEvaluatorAllowlist = evaluators;
        emit AllowlistEnforcementUpdated(providers, evaluators);
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit PauseUpdated(next);
    }

    function validateWorkflow(
        address token,
        uint96 totalBudget,
        uint96 compensationReserve,
        uint8 nodeCount
    ) external view returns (Limits memory snapshot) {
        if (paused) revert PolicyPaused();
        if (!allowedPaymentToken[token]) revert TokenNotAllowed();
        snapshot = _limits;
        if (totalBudget == 0 || totalBudget > snapshot.maximumTotalBudget) {
            revert BudgetOutOfBounds();
        }
        if (compensationReserve < snapshot.minimumCompensationReserve) {
            revert CompensationReserveTooLow();
        }
        if (nodeCount == 0 || nodeCount > snapshot.maximumNodes) revert NodeCountOutOfBounds();
    }

    function validateNode(address provider, address evaluator, uint96 budget) external view {
        if (budget == 0 || budget > _limits.maximumNodeBudget) revert NodeBudgetOutOfBounds();
        if (enforceProviderAllowlist && !allowedProvider[provider]) revert ProviderNotAllowed();
        if (enforceEvaluatorAllowlist && !allowedEvaluator[evaluator]) {
            revert EvaluatorNotAllowed();
        }
    }
}

