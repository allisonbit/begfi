"use client";

import { useEffect, useMemo, useState } from "react";
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
import { injected } from "wagmi/connectors";
import { DEFAULT_CHAIN_ID, robinhoodChain, shortAddress, txUrl } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { erc20Abi, formatAmount, parseAmount } from "@/lib/erc20";

/**
 * The send flow (spec §5.2, §7.2).
 *
 * A sender needs no account: open the link, connect a wallet, enter an amount,
 * send. The wallet calls `transfer` on the $BEG contract directly and BegFi
 * never touches the funds.
 *
 * Every precondition is checked and named before the button is usable, because
 * the failure modes here are not interchangeable: being on the wrong network,
 * having no ETH for gas, and not having enough $BEG are three different problems
 * with three different fixes, and a generic "transaction failed" tells the
 * person nothing.
 */
const PRESETS = [100n, 1_000n, 10_000n] as const;

const FIRST_SEND_KEY = "begfi:first-send-acknowledged";

export function SendPanel({ recipient, username }: { recipient: string; username: string }) {
  const token = BEG_TOKEN_ADDRESS;
  const [amount, setAmount] = useState("1000");
  const [preset, setPreset] = useState<bigint | null>(1_000n);
  const [acknowledged, setAcknowledged] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsed = useMemo(() => parseAmount(amount), [amount]);

  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;

  const { data: ethBalance } = useBalance({
    address,
    query: { enabled: Boolean(address) && !wrongChain },
  });

  const { data: tokenBalance } = useReadContract({
    abi: erc20Abi,
    address: token as `0x${string}`,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && token) && !wrongChain },
  });

  /**
   * The first-send warning (spec §7.2) is shown once per browser, and it blocks
   * the button until it is acknowledged. It is keyed to a value the user cannot
   * skip past by navigating: until the flag is set, the warning is what stands
   * between them and an irreversible send.
   */
  useEffect(() => {
    try {
      setAcknowledged(window.localStorage.getItem(FIRST_SEND_KEY) === "1");
    } catch {
      // Storage blocked. Treat the warning as already acknowledged rather than
      // blocking a send the person cannot get past — the same sentence is on
      // screen under the button either way.
      setAcknowledged(true);
    }
  }, []);

  function acknowledge() {
    setAcknowledged(true);
    try {
      window.localStorage.setItem(FIRST_SEND_KEY, "1");
    } catch {
      /* nothing to do — the state above already unblocked the button */
    }
  }

  const insufficientToken = parsed !== null && tokenBalance !== undefined && parsed > tokenBalance;
  const noGas = ethBalance !== undefined && ethBalance.value === 0n;
  const canSend =
    Boolean(token) &&
    isConnected &&
    !wrongChain &&
    parsed !== null &&
    parsed > 0n &&
    acknowledged &&
    !insufficientToken &&
    !noGas &&
    !isPending &&
    !confirming;

  async function send() {
    if (!token || parsed === null || !address) return;
    setError(null);

    try {
      await writeContractAsync({
        abi: erc20Abi,
        address: token as `0x${string}`,
        functionName: "transfer",
        args: [recipient as `0x${string}`, parsed],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /reject|denied|cancel/i.test(msg)
          ? "You rejected the transaction."
          : /insufficient funds/i.test(msg)
            ? "Not enough ETH to cover gas."
            : "The transaction couldn't be sent.",
      );
    }
  }

  // ---- sent -----------------------------------------------------------------
  if (isSuccess && hash) {
    return (
      <div className="rounded-2xl border-[1.5px] border-beg-lime p-5 text-center">
        <p className="w-fit rounded-md bg-beg-lime px-1.5 py-0.5 text-lg font-extrabold text-beg-ink">Sent</p>
        <p className="mt-1.5 text-[13px] text-beg-dim">
          {parsed ? `${formatAmount(parsed)} $BEG` : "$BEG"} to @{username}. Confirmed on-chain.
        </p>
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[13px] text-beg-ink underline underline-offset-2"
        >
          View transaction
        </a>
        <p className="mt-3 text-[13px] text-beg-dim">
          The total on this page updates once the indexer has recorded it.
        </p>
      </div>
    );
  }

  // ---- not connected --------------------------------------------------------
  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => void connectAsync({ connector: injected() })}
        className="btn-primary w-full p-4 text-[17px]"
      >
        Connect wallet
      </button>
    );
  }

  // ---- wrong network --------------------------------------------------------
  if (wrongChain) {
    return (
      <div className="grid gap-3">
        <p className="text-center text-[13px] text-beg-dim">
          Your wallet is on another network. $BEG only exists on {robinhoodChain.name}.
        </p>
        <button
          type="button"
          onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
          className="btn-primary w-full p-4 text-[17px]"
        >
          Switch to {robinhoodChain.name}
        </button>
      </div>
    );
  }

  // ---- the form -------------------------------------------------------------
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        {PRESETS.map((value) => (
          <button
            key={value.toString()}
            type="button"
            onClick={() => {
              setPreset(value);
              setAmount(value.toString());
            }}
            className={`flex-1 rounded-2xl border-[1.5px] py-3 text-[15px] font-bold ${
              preset === value ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-ink"
            }`}
          >
            {value >= 1_000n ? `${value / 1_000n}K` : value.toString()}
          </button>
        ))}
      </div>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Amount in $BEG</span>
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value.replace(/[^0-9.]/g, ""));
            setPreset(null);
          }}
          inputMode="decimal"
          placeholder="0"
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 font-bold text-beg-ink outline-none focus:border-beg-lime"
        />
      </label>

      {/* The recipient, before signing. Spec §7.2. */}
      <p className="text-center text-[13px] text-beg-dim">
        To <span className="text-beg-ink">@{username}</span>,{" "}
        <span className="font-mono">{shortAddress(recipient)}</span>
      </p>

      {tokenBalance !== undefined ? (
        <p className="text-center text-[13px] text-beg-dim">
          You hold {formatAmount(tokenBalance)} $BEG
        </p>
      ) : null}

      {noGas ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-center text-[13px] text-beg-ink">
          You have no ETH on {robinhoodChain.name}. Sends need a little ETH for gas.
        </p>
      ) : null}

      {insufficientToken ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-center text-[13px] text-beg-ink">
          Not enough $BEG for that amount.
        </p>
      ) : null}

      {!acknowledged ? (
        <div className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px]">
          <p className="text-beg-ink">
            Sends on a blockchain cannot be reversed. Check the username and the address above.
          </p>
          <button type="button" onClick={acknowledge} className="mt-2 font-bold text-beg-ink underline decoration-beg-lime decoration-2">
            I understand
          </button>
        </div>
      ) : null}

      {error ? <p className="text-center text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void send()}
        disabled={!canSend}
        className="btn-primary w-full p-4 text-[17px] disabled:opacity-40"
      >
        {isPending ? "Confirm in your wallet…" : confirming ? "Sending…" : `Send ${amount || "0"} $BEG`}
      </button>

      <p className="text-center text-[13px] text-beg-dim">
        Goes straight to their wallet. BegFi never holds it and takes no fee.
      </p>
    </div>
  );
}
