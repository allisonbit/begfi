"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits, parseEther } from "viem";
import { injected } from "wagmi/connectors";
import { DEFAULT_CHAIN_ID, robinhoodChain, txUrl } from "@/lib/chains";
import { getAmountOut, minOutFor, ponsCurveAbi } from "@/lib/curve";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";

/**
 * Buy a launched token, on the token's own page.
 *
 * The buy goes through the bonding curve, not a pool: `buy(quoteIn, minTokensOut,
 * recipient)` payable, with `msg.value` equal to `quoteIn` for a native launch.
 *
 * THE ESTIMATE IS AN ESTIMATE. The curve exposes no quote function, so the number
 * below is computed here from the reserves — see the note in lib/curve.ts for why
 * it can differ from the fill. What actually protects the buyer is `minTokensOut`,
 * which is derived from their slippage tolerance and causes the transaction to
 * revert rather than fill worse. The UI says "about" and means it.
 */
const SLIPPAGE_OPTIONS = [50n, 100n, 300n] as const; // 0.5%, 1%, 3%

export function BuyPanel({ token, curve, pairToken }: { token: string; curve: string; pairToken: string }) {
  const [amount, setAmount] = useState("0.01");
  const [slippageBps, setSlippageBps] = useState<bigint>(100n);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;

  const { data: config } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "getLaunchConfig",
    args: [0n],
  });

  const { data: reserves } = useReadContract({
    abi: ponsCurveAbi,
    address: curve as `0x${string}`,
    functionName: "getReserves",
  });

  const { data: isNative } = useReadContract({
    abi: ponsCurveAbi,
    address: curve as `0x${string}`,
    functionName: "isNativeQuote",
  });

  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) && !wrongChain },
  });

  const quoteIn = useMemo(() => {
    try {
      const parsed = parseEther(amount as `${number}`);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }, [amount]);

  /**
   * The estimate. `reserveIn`/`reserveOut` come straight from the curve's own
   * `getReserves()`, and the fee is the config's curve fee — the same inputs the
   * library is given internally, as far as can be established from outside.
   */
  const quote = useMemo(() => {
    if (!quoteIn || !reserves || config === undefined) return null;
    const [quoteReserve, tokenReserve] = reserves;
    if (quoteReserve === 0n || tokenReserve === 0n) return null;

    return getAmountOut(quoteIn, quoteReserve, tokenReserve, config[1]);
  }, [quoteIn, reserves, config]);

  const minOut = quote === null ? null : minOutFor(quote, slippageBps);
  const notEnough = quoteIn !== null && balance !== undefined && balance.value < quoteIn;

  const canBuy =
    isConnected &&
    !wrongChain &&
    quoteIn !== null &&
    minOut !== null &&
    !notEnough &&
    !isPending &&
    !confirming;

  // A non-native curve takes an ERC-20 as the quote, which this panel does not
  // support yet. Saying so is better than sending ETH a contract will reject.
  const unsupportedQuote = isNative === false;

  async function buy() {
    setError(null);
    if (!quoteIn || minOut === null || !address) return;

    try {
      await writeContractAsync({
        abi: ponsCurveAbi,
        address: curve as `0x${string}`,
        functionName: "buy",
        args: [quoteIn, minOut, address],
        value: quoteIn,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /reject|denied|cancel/i.test(msg)
          ? "You rejected the transaction."
          : /slippage|InsufficientOutput/i.test(msg)
            ? "The price moved past your slippage limit. Try again or raise it."
            : /insufficient funds/i.test(msg)
              ? "Not enough ETH."
              : "The buy didn't go through.",
      );
    }
  }

  if (isSuccess && hash) {
    return (
      <div className="rounded-2xl border-[1.5px] border-beg-lime p-5 text-center">
        <p className="text-lg font-extrabold text-beg-lime">Bought</p>
        <p className="mt-1.5 text-[13px] text-beg-dim">
          Confirmed on-chain. The tokens are in your wallet.
        </p>
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[13px] text-beg-ink underline underline-offset-2"
        >
          View transaction
        </a>
      </div>
    );
  }

  if (unsupportedQuote) {
    return (
      <p className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-4 text-center text-[13px] text-beg-dim">
        This token trades against an ERC-20 rather than ETH, which buying here doesn&apos;t support yet.
      </p>
    );
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => void connectAsync({ connector: injected() })}
        className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg"
      >
        Connect wallet
      </button>
    );
  }

  if (wrongChain) {
    return (
      <div className="grid gap-3">
        <p className="text-center text-[13px] text-beg-dim">
          Your wallet is on another network. This token is on {robinhoodChain.name}.
        </p>
        <button
          type="button"
          onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
          className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg"
        >
          Switch to {robinhoodChain.name}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Spend (ETH)</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 font-bold text-beg-lime outline-none focus:border-beg-lime"
        />
      </label>

      <div className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px]">
        <div className="flex justify-between">
          <span className="text-beg-dim">You receive</span>
          <span className="font-bold text-beg-lime">
            {quote === null ? "—" : `about ${formatTokens(quote)}`}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="text-beg-dim">Minimum received</span>
          <span className="text-beg-ink">{minOut === null ? "—" : formatTokens(minOut)}</span>
        </div>
        <p className="mt-2 text-[12px] text-beg-dim">
          An estimate from the curve&apos;s reserves. The minimum is what the transaction enforces — it
          reverts rather than fill below it.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[13px] text-beg-dim">Slippage</span>
        {SLIPPAGE_OPTIONS.map((bps) => (
          <button
            key={bps.toString()}
            type="button"
            onClick={() => setSlippageBps(bps)}
            className={`rounded-full border-[1.5px] px-3 py-1.5 text-[13px] font-bold ${
              slippageBps === bps ? "border-beg-lime text-beg-lime" : "border-beg-line text-beg-ink"
            }`}
          >
            {Number(bps) / 100}%
          </button>
        ))}
      </div>

      {notEnough ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          Not enough ETH, and you need a little spare for gas.
        </p>
      ) : null}

      {error ? <p className="text-center text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void buy()}
        disabled={!canBuy}
        className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg disabled:opacity-40"
      >
        {isPending ? "Confirm in your wallet…" : confirming ? "Buying…" : `Buy with ${amount || "0"} ETH`}
      </button>

      <p className="text-center text-[13px] text-beg-dim">
        A purchase cannot be undone. This token is not endorsed by BegFi or Robinhood.
      </p>
    </div>
  );
}

/** Token amounts, trimmed to something readable rather than 18 decimals of noise. */
function formatTokens(value: bigint): string {
  const asNumber = Number(formatUnits(value, 18));
  if (asNumber === 0) return "0";
  if (asNumber >= 1_000_000) return `${(asNumber / 1_000_000).toFixed(2)}M`;
  if (asNumber >= 1_000) return `${(asNumber / 1_000).toFixed(2)}K`;
  return asNumber.toFixed(4);
}
