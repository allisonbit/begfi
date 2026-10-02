// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { BegSplitter } from "./BegSplitter.sol";

/**
 * @title BegSplitterFactory
 * @notice Deploys one splitter per launch as a minimal clone (spec §9.3).
 *
 * The splitter implementation is deployed once, here, in this constructor, and
 * every launch gets an EIP-1167 clone of it — a few hundred bytes of bytecode
 * rather than a full redeploy. The implementation's own constructor calls
 * `_disableInitializers()`, so the implementation itself can never be taken over;
 * only clones, which are initialised exactly once each by this factory, are live.
 *
 * This factory holds no funds and has no owner. It cannot upgrade, replace, or
 * reach into a splitter it has already created — a launcher's splitter is theirs
 * from the moment it exists, which is the property that makes the "no upgrade
 * proxy" promise in the splitter actually mean something.
 */
contract BegSplitterFactory {
    using Clones for address;

    /// @notice The implementation every clone delegates to.
    address public immutable implementation;

    event SplitterCreated(address indexed splitter, address indexed launcher, BegSplitter.Mode mode);

    constructor() {
        implementation = address(new BegSplitter());
    }

    /**
     * @notice Create a splitter for one launch.
     *
     * @dev No access control on purpose. Anyone may create a splitter; what they
     *      cannot do is make a launcher's splitter pay them, because `launcher`
     *      and `treasury` are fixed at initialisation and there is no setter.
     *      Gating this would only add a key to lose.
     */
    function createSplitter(
        BegSplitter.Mode mode,
        address treasury,
        address launcher,
        address controller,
        address begToken,
        address buybackRouter,
        address weth
    ) external returns (address splitter) {
        splitter = implementation.clone();

        BegSplitter(payable(splitter)).initialize(
            mode,
            treasury,
            launcher,
            controller,
            begToken,
            buybackRouter,
            weth
        );

        emit SplitterCreated(splitter, launcher, mode);
    }
}
