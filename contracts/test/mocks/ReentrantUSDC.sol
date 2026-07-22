// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ReentrantUSDC is ERC20 {
    address public target;
    bool public attempted;
    bool public callbackSucceeded;

    constructor() ERC20("Reentrant USDC", "rUSDC") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address next) external {
        target = next;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (!attempted && target != address(0)) {
            attempted = true;
            (callbackSucceeded,) = target.call(abi.encodeWithSignature("fund()"));
        }
        return super.transferFrom(from, to, value);
    }
}
