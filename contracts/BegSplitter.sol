// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title BegSplitter
 * @notice Holds a launched token's creator-tax proceeds and lets each party take
 *         their own share, when they choose. Spec §9.3.
 *
 * SHAPE. One contract per launch, deployed as a minimal clone of a single
 * implementation, and set as the token's creator-tax recipient. It receives ETH
 * and splits it three ways in standard mode, or hands all of it to the dev
 * wallet in genesis mode.
 *
 * WHAT THIS CONTRACT IS NOT. No upgrade proxy, no owner, no pause, no sweep.
 * The split percentages are `constant`s. There is no function anywhere in this
 * file that can change them, move another party's share, or stop a claim. That
 * is the point: a launcher's and the treasury's money must not depend on the
 * good behaviour of whoever holds a key, and a deployed contract with no
 * upgrade path means the audit at the end of Phase 2 is the only chance to be
 * right — which is why that audit is a hard gate and not a nice-to-have.
 *
 * PULL, NOT PUSH. Nothing here sends money anywhere on its own. Fees accumulate
 * as credits and each party calls `claim()`. Spec §9.3 is explicit about this,
 * and it is also the safer shape: a push that reverts because one recipient's
 * wallet is a contract that rejects ETH would block everyone else's share.
 *
 *** THE PONS ASSUMPTION — READ BEFORE DEPLOYING ***
 *
 * Spec §9.3 assumes this contract is set as the creator-tax recipient and that
 * proceeds then arrive here. Verification on 2026-10-02 found this is only half
 * confirmed:
 *
 *   - Pons V2 pays creators in ETH by default. Confirmed.
 *   - Whether a CONTRACT may be the recipient is NOT confirmed.
 *   - More importantly, Pons does not appear to push creator fees at all. It
 *     accumulates them as a claimable balance inside a Pons "fee escrow
 *     contract", and the recipient pulls from there.
 *
 * So `receive()` alone may never see a single wei. If Pons is pull-based, this
 * contract needs one more function — a call into Pons' escrow that claims into
 * `address(this)` — and that needs Pons' escrow ABI, which we do not have.
 * `receive()` is implemented and correct either way, and the accounting below
 * is agnostic to how the ETH arrives. But DO NOT DEPLOY THIS expecting fees to
 * appear until that mechanism is settled against Pons' real contracts.
 */
contract BegSplitter is Initializable {
    /// @notice Genesis mode is the $BEG launch itself: everything to the dev
    ///         wallet, no growth fund. Standard is every launch after it.
    enum Mode {
        Standard,
        Genesis
    }

    /// @dev Basis points, and the split. 3333 + 3333 = 6666, and the growth fund
    ///      takes the remainder rather than a third constant, so that integer
    ///      division can never strand a wei in the contract.
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant TREASURY_BPS = 3_333;
    uint256 public constant LAUNCHER_BPS = 3_333;

    Mode public mode;
    address public treasury;
    address public launcher;
    address public controller;
    address public begToken;
    address public buybackRouter;
    address public weth;

    /// @notice Cumulative ETH that has arrived, counted at `msg.value` — never
    ///         at `address(this).balance`.
    uint256 public totalReceived;
    /// @notice Cumulative ETH that has been credited to the buckets below.
    ///         `totalReceived - totalCredited` is what the next `sync()` splits.
    uint256 public totalCredited;

    uint256 public creditedTreasury;
    uint256 public creditedLauncher;
    uint256 public creditedGrowthFund;

    uint256 public claimedTreasury;
    uint256 public claimedLauncher;
    uint256 public spentGrowthFund;

    event Synced(uint256 amount, uint256 toTreasury, uint256 toLauncher, uint256 toGrowthFund);
    event Claimed(address indexed account, uint256 amount);
    event GrowthFundWithdrawn(address indexed to, uint256 amount);
    event BuybackExecuted(uint256 amountIn, uint256 amountOut);

    error AlreadyInitialized();
    error ZeroAddress();
    error NotEntitled(address caller);
    error NothingToClaim();
    error AmountUnavailable(uint256 requested);
    error TransferFailed(address to, uint256 amount);
    error BuybackNotConfigured();
    error NotController(address caller);

    modifier onlyController() {
        if (msg.sender != controller) revert NotController(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // The implementation contract is never used directly; only clones of it
        // are. Sealing the implementation prevents someone initialising it and
        // taking it over.
        _disableInitializers();
    }

    /**
     * @notice Configure one launch's splitter. Called once, on the clone.
     *
     * @param mode_           Genesis for $BEG itself, Standard for everything else.
     * @param treasury_       BegFi's wallet. Receives a third in standard mode.
     * @param launcher_       The launcher's payout wallet. In genesis mode this is
     *                        the dev wallet and receives everything.
     * @param controller_     The only address that may spend the growth fund. A
     *                        multisig (spec §9.3) — with a single hot wallet this
     *                        is the whole fund's security model.
     * @param begToken_       $BEG, the asset a buyback buys. Zero until it exists.
     * @param buybackRouter_  Router used by `executeBuyback`. Zero until a DEX is
     *                        chosen and its interface confirmed — see the note on
     *                        `executeBuyback`.
     * @param weth_           Wrapped ETH for the swap path. Zero until then.
     */
    function initialize(
        Mode mode_,
        address treasury_,
        address launcher_,
        address controller_,
        address begToken_,
        address buybackRouter_,
        address weth_
    ) external initializer {
        if (treasury_ == address(0) || launcher_ == address(0) || controller_ == address(0)) {
            revert ZeroAddress();
        }

        mode = mode_;
        treasury = treasury_;
        launcher = launcher_;
        controller = controller_;
        begToken = begToken_;
        buybackRouter = buybackRouter_;
        weth = weth_;
    }

    /**
     * @notice Accept creator-tax proceeds.
     *
     * `totalReceived` is counted here rather than read from the contract's
     * balance, and that distinction is deliberate. ETH can be forced into any
     * contract with `selfdestruct` or as a block's coinbase reward, and a
     * balance-delta sync would credit that forced ETH to the three parties —
     * letting anyone inflate everyone's share, or make `claim()` pay out money
     * that was never really the launch's. Counting only `msg.value` means forced
     * ETH is simply never credited. It sits in the contract, unspendable by
     * anyone. That is the safe failure: stranded, not stolen.
     */
    receive() external payable {
        totalReceived += msg.value;
    }

    /**
     * @notice Split whatever has arrived since the last sync.
     *
     * Callable by anyone, and called automatically at the start of every claim —
     * so nobody has to remember to run it, and nobody can be front-run by
     * someone syncing at a moment of their choosing, because the arithmetic
     * divides the whole delta identically whenever it happens.
     */
    function sync() public {
        uint256 delta = totalReceived - totalCredited;
        if (delta == 0) return;

        totalCredited += delta;

        if (mode == Mode.Genesis) {
            creditedLauncher += delta;
            emit Synced(delta, 0, delta, 0);
            return;
        }

        uint256 toTreasury = (delta * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 toLauncher = (delta * LAUNCHER_BPS) / BPS_DENOMINATOR;
        uint256 toGrowth = delta - toTreasury - toLauncher;

        creditedTreasury += toTreasury;
        creditedLauncher += toLauncher;
        creditedGrowthFund += toGrowth;

        emit Synced(delta, toTreasury, toLauncher, toGrowth);
    }

    /// @notice What the launcher could take right now, including unsynced fees.
    function claimableLauncher() public view returns (uint256) {
        uint256 pending = totalReceived - totalCredited;
        uint256 credit = creditedLauncher;

        if (pending > 0) {
            credit += mode == Mode.Genesis ? pending : (pending * LAUNCHER_BPS) / BPS_DENOMINATOR;
        }

        return credit - claimedLauncher;
    }

    /// @notice What the treasury could take right now. Always zero in genesis mode.
    function claimableTreasury() public view returns (uint256) {
        if (mode == Mode.Genesis) return 0;

        uint256 pending = totalReceived - totalCredited;
        uint256 credit = creditedTreasury;
        if (pending > 0) credit += (pending * TREASURY_BPS) / BPS_DENOMINATOR;

        return credit - claimedTreasury;
    }

    /// @notice What the controller may spend from the growth fund.
    function growthFundAvailable() public view returns (uint256) {
        if (mode == Mode.Genesis) return 0;

        uint256 pending = totalReceived - totalCredited;
        uint256 credit = creditedGrowthFund;
        if (pending > 0) {
            uint256 toTreasury = (pending * TREASURY_BPS) / BPS_DENOMINATOR;
            uint256 toLauncher = (pending * LAUNCHER_BPS) / BPS_DENOMINATOR;
            credit += pending - toTreasury - toLauncher;
        }

        return credit - spentGrowthFund;
    }

    /**
     * @notice Take your own share.
     *
     * Pays `msg.sender` and nothing else, so there is no parameter to aim at
     * another address. The launcher and the treasury are the only two entitled
     * callers; the growth fund is not claimable this way and can only be spent
     * by the controller through the two functions below.
     */
    function claim() external {
        sync();

        uint256 amount;

        if (msg.sender == launcher) {
            amount = creditedLauncher - claimedLauncher;
            claimedLauncher += amount;
        } else if (msg.sender == treasury && mode == Mode.Standard) {
            amount = creditedTreasury - claimedTreasury;
            claimedTreasury += amount;
        } else {
            revert NotEntitled(msg.sender);
        }

        if (amount == 0) revert NothingToClaim();

        _send(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Spend part of the growth fund on marketing or anything else.
     *
     * Controller only. Every call is an event, so the fund's spending is public
     * whether or not anyone asks — which is what makes "at the team's
     * discretion" a defensible thing to write in the terms (spec §9.3).
     */
    function withdrawGrowthFund(address to, uint256 amount) external onlyController {
        if (to == address(0)) revert ZeroAddress();

        uint256 available = growthFundAvailable();
        if (amount == 0 || amount > available) revert AmountUnavailable(amount);

        spentGrowthFund += amount;
        _send(to, amount);
        emit GrowthFundWithdrawn(to, amount);
    }

    /**
     * @notice Buy $BEG with part of the growth fund.
     *
     * CONTROLLER ONLY, AND UNCONFIGURED BY DEFAULT.
     *
     * The router interface below is Uniswap V2's `swapExactETHForTokens`. Pons
     * V2 on Robinhood Chain is built around Uniswap V4 hooks, so this signature
     * is a GUESS and must be checked against whatever router is actually used
     * before `buybackRouter` is set to a non-zero address. Because both
     * `buybackRouter` and `begToken` start at zero and this reverts while either
     * is unset, the function cannot do anything wrong until someone deliberately
     * configures it — and configuring it is a decision requiring the real
     * router's ABI, not a silent default.
     *
     * If the chain's DEX turns out not to be V2-shaped, replace this body; the
     * accounting around it (`spentGrowthFund`) is what matters and does not
     * change.
     */
    function executeBuyback(uint256 amountIn, uint256 minAmountOut) external onlyController {
        if (buybackRouter == address(0) || begToken == address(0) || weth == address(0)) {
            revert BuybackNotConfigured();
        }

        uint256 available = growthFundAvailable();
        if (amountIn == 0 || amountIn > available) revert AmountUnavailable(amountIn);

        spentGrowthFund += amountIn;

        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = begToken;

        uint256[] memory amounts = IBegBuybackRouter(buybackRouter).swapExactETHForTokens{ value: amountIn }(
            minAmountOut,
            path,
            address(this),
            block.timestamp
        );

        emit BuybackExecuted(amountIn, amounts[amounts.length - 1]);
    }

    /**
     * @dev `call`, not `transfer`. `transfer` forwards a fixed 2300 gas and
     *      reverts against any recipient that is a contract doing more than
     *      nothing — including a multisig, which is exactly what the treasury
     *      and controller are meant to be. Reverting on failure rather than
     *      swallowing it keeps a failed payout from being silently marked as
     *      claimed.
     */
    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }
}

/**
 * @dev The one external call this contract makes. Deliberately minimal, and
 *      deliberately the only place a router's shape is assumed.
 */
interface IBegBuybackRouter {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
}
