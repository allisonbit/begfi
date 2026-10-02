// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title MockPonsEscrow
 *
 * *** TESTS ONLY. NEVER DEPLOY THIS. ***
 *
 * A stand-in for Pons' fee escrow, reproducing the three members of the real
 * interface that BegFi depends on — verified on-chain from Sourcify:
 *
 *     balanceOf(address recipient) view
 *     claim()                      nonpayable -> uint256
 *     credit(address recipient)    payable
 *
 * The behaviour that matters and is reproduced exactly: **`claim()` takes no
 * recipient and pays the caller.** That is the single fact shaping
 * `BegSplitter.pullFromEscrow`, and a mock that took a recipient parameter would
 * let the splitter pass tests against an interface the real escrow does not have.
 *
 * The real escrow is a third party's contract with a reentrancy guard, ERC-20
 * support, and errors this does not model. Nothing here is a substitute for
 * testing against the real thing once a launch exists.
 */
contract MockPonsEscrow {
    mapping(address => uint256) private _balances;

    error NoBalance();
    error TransferFailed();

    event Credited(address indexed recipient, uint256 amount);
    event Claimed(address indexed recipient, uint256 amount);

    function balanceOf(address recipient) external view returns (uint256) {
        return _balances[recipient];
    }

    /// @dev The real escrow is credited by the protocol when trades occur. Here,
    ///      funding it directly is how a test simulates that.
    function credit(address recipient) external payable {
        _balances[recipient] += msg.value;
        emit Credited(recipient, msg.value);
    }

    /// @dev Pays the CALLER, like the real one. No recipient parameter, on
    ///      purpose — see the note above.
    function claim() external returns (uint256 amount) {
        amount = _balances[msg.sender];
        if (amount == 0) revert NoBalance();

        _balances[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{ value: amount }("");
        if (!ok) revert TransferFailed();

        emit Claimed(msg.sender, amount);
    }
}
