// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title BegSplitter
 * @notice Holds a launched token's creator-tax proceeds and lets each party take
 *         their own share, when they choose. Spec §9.3.
 *
 * SHAPE. One contract per launch, deployed as a minimal clone of a single
 * implementation, and set as the token's creator-fee recipient. It receives ETH
 * and splits it three ways in standard mode, or hands all of it to the dev
 * wallet in genesis mode.
 *
 * WHAT THIS CONTRACT IS NOT. No upgrade proxy, no owner, no pause, no sweep. The
 * split percentages are `constant`s. There is no function anywhere in this file
 * that can change them, move another party's share, or stop a claim. That is the
 * point: a launcher's and the treasury's money must not depend on the good
 * behaviour of whoever holds a key, and a deployed contract with no upgrade path
 * means the audit at the end of Phase 2 is the only chance to be right — which is
 * why that audit is a hard gate and not a nice-to-have.
 *
 * PULL, NOT PUSH. Nothing here sends a party their share on its own. Fees
 * accumulate as credits and each party calls `claim()`. Spec §9.3 is explicit
 * about this, and it is also the safer shape: a push that reverts because one
 * recipient's wallet is a contract that rejects ETH would block everyone else's
 * share.
 *
 *** HOW THE MONEY ACTUALLY ARRIVES — researched 2026-10-02 ***
 *
 * There are TWO mechanisms, and which one applies is not settled for a given
 * launch. Both are handled here, and `receive()` is indifferent to which was
 * used, so the split arithmetic is identical either way.
 *
 *   1. PUSH. Pons' own documentation says creator rewards accrue in the token's
 *      locked position and that "pons automation may claim and route them to the
 *      creator payout wallet". If the payout wallet is this splitter, the ETH
 *      simply arrives through `receive()`. Nothing else is needed.
 *
 *   2. PULL. The escrow at 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e exposes,
 *      verified on-chain:
 *
 *          balanceOf(address recipient) view
 *          claim()                      nonpayable -> uint256
 *          claim(uint256 amount)        nonpayable -> uint256
 *          credit(address recipient)    payable
 *
 *      `claim()` takes NO recipient — the caller IS the recipient. So if fees
 *      land there addressed to this splitter, somebody has to call it, which is
 *      what `pullFromEscrow()` below is for.
 *
 * `escrow` is a PER-LAUNCH PARAMETER rather than a constant precisely because
 * which mechanism applies is unresolved. A zero address disables the pull path
 * cleanly, which is the honest setting for a launch whose fees arrive by push.
 *
 * *** CONFIRMED: A CONTRACT MAY BE THE CREATOR-FEE RECIPIENT ***
 *
 * Read from Pons' own V2 factory source (ponsdotdev/ponsfamily, MIT,
 * contractsV2/src/v2/PonsV2LaunchFactory.sol) on 2026-10-02. There is NO
 * `code.length == 0` test on the recipient anywhere in it — the only code-length
 * check in that file applies to the quote asset, not to the recipient. Any
 * non-zero address is accepted, contracts included. The assignment is:
 *
 *     params.creatorFeeRecipient == address(0) ? originalDeployer : params.creatorFeeRecipient
 *
 * so a zero recipient falls back to the launcher, and later updates reject zero
 * with `ZeroAddress()`. A transfer of the recipient requires
 * `msg.sender == launch.creatorFeeRecipient`, so once this splitter is set it is
 * also the only thing that can hand the role on.
 *
 *** ONE STEP BEFORE THE ESCROW: FEES MUST BE SWEPT ***
 *
 * Discovered in Pons' docs and NOT modelled here, because it may be the
 * protocol's job rather than ours. Fees do not reach the escrow on their own:
 *
 *   - pre-graduation, `sweepFees(minBuybackTokensOut)` on the bonding curve
 *   - post-graduation, `sweepPoolFees(poolId, minConversionQuoteOut, minBuybackTokensOut)`
 *     on the meme hook
 *
 * Both are callable by "the protocol's sweep operator or the creator", and a
 * creator's own call reverts `InternalSwapRequiresOperator` when an internal
 * swap is needed. Until a sweep runs, the money sits in `quoteFeeBalance` /
 * `creatorTaxBalance` (curve) or `pendingFees` / `pendingCreatorTax` (hook) and
 * the escrow reports zero.
 *
 * So the full path is: trade → sweep → escrow → `pullFromEscrow()` → `claim()`.
 * This contract covers the last two. If Pons' operator sweeps on a schedule, the
 * first is theirs and nothing here needs to change. If it is left to the
 * creator, a sweep has to be triggered separately before any of this sees money.
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

    /// @notice Pons' fee escrow, where creator fees accumulate until claimed.
    address public escrow;

    /// @notice Uniswap V3 SwapRouter, used only by `executeBuyback`.
    address public swapRouter;

    /// @notice Wrapped ETH, the input side of a buyback swap.
    address public weth;

    /// @notice The pool fee tier for the $BEG/WETH pool, in hundredths of a bip.
    ///         Pons V1 launches into a 1% pool, so the default is 10_000.
    uint24 public poolFee;

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
    event EscrowPulled(uint256 amount);

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
     * @param mode_        Genesis for $BEG itself, Standard for everything else.
     * @param treasury_    BegFi's wallet. Receives a third in standard mode.
     * @param launcher_    The launcher's payout wallet. In genesis mode this is
     *                     the dev wallet and receives everything.
     * @param controller_  The only address that may spend the growth fund and
     *                     run a buyback. A multisig (spec §9.3) — with a single
     *                     hot wallet this is the whole fund's security model.
     * @param begToken_    $BEG, the asset a buyback buys.
     * @param escrow_      Pons' fee escrow. Zero disables `pullFromEscrow`, which
     *                     is the honest setting for a chain where fees arrive by
     *                     some other route.
     * @param swapRouter_  Uniswap V3 SwapRouter. Zero leaves buybacks unavailable.
     * @param weth_        Wrapped ETH, the swap's input token.
     * @param poolFee_     The $BEG/WETH pool fee tier.
     */
    function initialize(
        Mode mode_,
        address treasury_,
        address launcher_,
        address controller_,
        address begToken_,
        address escrow_,
        address swapRouter_,
        address weth_,
        uint24 poolFee_
    ) external initializer {
        if (treasury_ == address(0) || launcher_ == address(0) || controller_ == address(0)) {
            revert ZeroAddress();
        }

        mode = mode_;
        treasury = treasury_;
        launcher = launcher_;
        controller = controller_;
        begToken = begToken_;
        escrow = escrow_;
        swapRouter = swapRouter_;
        weth = weth_;
        poolFee = poolFee_;
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
     * @notice Pull this splitter's accumulated creator fees out of Pons' escrow.
     *
     * PERMISSIONLESS, and it has to be — the escrow's `claim()` pays its caller,
     * so somebody has to call it, and there is no reason for that somebody to be
     * the controller. Anyone may run it; the money lands here and is split by the
     * same arithmetic regardless of who triggered it, so no caller can gain by
     * choosing the moment.
     *
     * The claimed ETH arrives through `receive()` and is counted there, so this
     * function deliberately does not touch the accounting itself.
     *
     * @return claimed the amount the escrow reported paying out.
     */
    function pullFromEscrow() external returns (uint256 claimed) {
        if (escrow == address(0)) return 0;

        // Check before claiming. Pons' escrow REVERTS with `NoBalance()` when the
        // caller has nothing to collect, and this function is permissionless —
        // meant to be called by a keeper, a cron, or whichever party wants their
        // money first. A blind call that simply has nothing to do should be a
        // no-op, not a failed transaction: reverting would make every scheduled
        // run fail on every quiet day, and a monitor that always shows red is a
        // monitor nobody reads.
        if (IPonsFeeEscrow(escrow).balanceOf(address(this)) == 0) return 0;

        claimed = IPonsFeeEscrow(escrow).claim();

        if (claimed > 0) emit EscrowPulled(claimed);
    }

    /// @notice What Pons' escrow is currently holding for this splitter.
    function escrowBalance() external view returns (uint256) {
        if (escrow == address(0)) return 0;
        return IPonsFeeEscrow(escrow).balanceOf(address(this));
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
     * CONTROLLER ONLY, AND UNAVAILABLE UNTIL CONFIGURED.
     *
     * The interface below is Uniswap V3's `SwapRouter.exactInputSingle`. That is
     * the right shape for a **V1** launch, which seeds each token into a Uniswap
     * V3 1% pool. It is probably the WRONG shape for a V2 launch, which trades on
     * a bonding curve and graduates into a Uniswap V4 pool with a meme hook — V4
     * swaps go through the hook, not a V3 router.
     *
     * Worth knowing before building any of this: Pons V2 already runs its own
     * buyback. `getLaunchFeePolicy(token)` returns a `FeePolicy` with a
     * `buybackBurnBps` share, and there is a protocol buyback vault at
     * 0x42df2a798f82289E177311362e8f5ccC45c1219c. A BegFi-run buyback on top of
     * that may be redundant, and a growth fund that can simply be withdrawn may
     * be the better design. Spec §9.3 asks for a buyback function; this is it,
     * configured off, and whether to use it is a decision rather than a default.
     *
     * Because `swapRouter`, `begToken` and `weth` all start at zero and this
     * reverts while any is unset, the function cannot do anything at all until
     * somebody deliberately supplies real addresses for the version in use.
     *
     * The tokens bought are sent to this contract. Spending or burning them is a
     * separate, controller-only act — spec §9.3 leaves that open, and adding a
     * destination here without deciding it would be inventing policy.
     */
    function executeBuyback(uint256 amountIn, uint256 minAmountOut) external onlyController {
        if (swapRouter == address(0) || begToken == address(0) || weth == address(0)) {
            revert BuybackNotConfigured();
        }

        uint256 available = growthFundAvailable();
        if (amountIn == 0 || amountIn > available) revert AmountUnavailable(amountIn);

        spentGrowthFund += amountIn;

        uint256 amountOut = ISwapRouterV3(swapRouter).exactInputSingle{ value: amountIn }(
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: begToken,
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        emit BuybackExecuted(amountIn, amountOut);
    }

    /**
     * @dev `call`, not `transfer`. `transfer` forwards a fixed 2300 gas and
     *      reverts against any recipient that is a contract doing more than
     *      nothing — including a multisig, which is exactly what the treasury
     *      and controller are meant to be. Reverting on failure rather than
     *      swallowing it keeps a failed payout from being silently marked as
     *      claimed.
     *
     *      Callers update their accounting before calling this (checks-effects-
     *      interactions), so a reentrant call finds nothing left to take.
     */
    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }
}

/**
 * @dev Pons' fee escrow, as verified on-chain (Sourcify, 2026-10-02). Only the
 *      two members this contract uses are declared.
 *
 *      `claim()` takes no recipient: the caller is the recipient. That is the
 *      single fact that shapes `pullFromEscrow` above.
 */
interface IPonsFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function claim() external returns (uint256);
}

/**
 * @dev Uniswap V3 SwapRouter. `exactInputSingle` is the whole of the swap; the
 *      struct is nested because that is how the router declares it.
 */
interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
