// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestToken
 *
 * *** LOCAL DEVELOPMENT ONLY. NEVER DEPLOY THIS. ***
 *
 * A stand-in for $BEG so the send flow can be exercised end to end against
 * `npx hardhat node` (which runs at chainId 4663, the same as Robinhood Chain)
 * before $BEG exists anywhere.
 *
 * The real $BEG is a Pons launch (spec §9.1) — it is not this contract, and no
 * amount of it is real. This has an open `mint` because a local faucet has to be
 * open to be useful; on a public chain that would be a way to print unlimited
 * supply. There is no chain on which this belongs.
 *
 * It exists in `contracts/` rather than a test fixture directory because Hardhat
 * only compiles one source path. The safety comes from never deploying it, not
 * from where the file sits: the deploy script does not reference it.
 */
contract TestToken is ERC20 {
    /// @dev 1 billion, matching the fixed supply a Pons launch produces, so
    ///      amount handling in the UI is exercised against a realistic scale.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000e18;

    constructor() ERC20("BegFi Test Token", "tBEG") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @dev Local faucet. See the warning above.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
