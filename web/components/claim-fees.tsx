"use client";

import { useAccount, useChainId, useConnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { injected } from "wagmi/connectors";
import { DEFAULT_CHAIN_ID, robinhoodChain, txUrl } from "@/lib/chains";
import { PONS_FACTORY, ponsEscrowAbi, ponsFactoryAbi } from "@/lib/pons";

/**
 * Claim creator fees out of Pons' escrow.
 *
 * READ FROM THE CONTRACT, NEVER FROM OUR DATABASE. Spec §9.5 is explicit about
 * this, and it is the right instinct generally: a claimable balance in our own
 * table could be stale, wrong, or simply invented, and the number a person acts
 * on is the number the contract will actually pay.
 *
 * The escrow address comes from the factory rather than a constant, because the
 * docs warn that reading a creator balance from the wrong escrow silently reports
 * zero — a wrong number that looks exactly like "you have earned nothing".
 *
 * `claim()` takes no recipient: the caller IS the recipient. So this can only
 * ever pay the connected wallet, which is why it is safe for it to be a plain
 * button with no address field.
 */
export function ClaimFees({ wallet }: { wallet: string }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: escrow } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "feeEscrow",
  });

  const { data: claimable, refetch } = useReadContract({
    abi: ponsEscrowAbi,
    address: escrow,
    functionName: "balanceOf",
    args: [wallet as `0x${string}`],
    query: { enabled: Boolean(escrow) },
  });

  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;
  const amount = claimable ?? 0n;
  const hasSomething = amount > 0n;

  async function claim() {
    if (!escrow) return;
    try {
      await writeContractAsync({
        abi: ponsEscrowAbi,
        address: escrow,
        functionName: "claim",
      });
      void refetch();
    } catch {
      /* the wallet surfaces its own rejection; nothing to add */
    }
  }

  if (isSuccess) {
    return (
      <div className="rounded-2xl border-[1.5px] border-beg-lime p-5 text-[13px]">
        <p className="font-bold text-beg-lime">Claimed</p>
        <p className="mt-1 text-beg-dim">The ETH is in your wallet.</p>
        {hash ? (
          <a
            href={txUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-beg-ink underline underline-offset-2"
          >
            View transaction
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <section className="grid gap-3 rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-beg-dim">Creator fees available</span>
        <span className="text-[28px] font-extrabold tracking-[-.04em] text-beg-lime">
          {trim(formatEther(amount))} ETH
        </span>
      </div>

      {hasSomething ? (
        wrongChain ? (
          <button
            type="button"
            onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
            className="rounded-full bg-beg-lime p-3.5 font-bold text-beg-bg"
          >
            Switch to {robinhoodChain.name}
          </button>
        ) : isConnected ? (
          <button
            type="button"
            onClick={() => void claim()}
            disabled={isPending || confirming}
            className="rounded-full bg-beg-lime p-3.5 font-bold text-beg-bg disabled:opacity-40"
          >
            {isPending ? "Confirm in your wallet…" : confirming ? "Claiming…" : "Claim fees"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connectAsync({ connector: injected() })}
            className="rounded-full bg-beg-lime p-3.5 font-bold text-beg-bg"
          >
            Connect to claim
          </button>
        )
      ) : (
        <p className="text-[13px] text-beg-dim">
          Nothing to claim yet. Fees accrue as your tokens are traded, and they have to be swept out
          of the curve before they reach this balance.
        </p>
      )}

      <p className="text-[12px] text-beg-dim">
        Read from Pons&apos; escrow contract, not from BegFi. Claiming is always your choice and
        nothing is taken automatically.
      </p>
    </section>
  );
}

/** ETH with trailing zeros removed, so 0.0000 doesn't render as a balance. */
function trim(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "") || "0";
}
