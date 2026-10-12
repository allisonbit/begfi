"use client";

import { useAccount, useChainId, useReadContract, useSwitchChain } from "wagmi";
import { formatEther } from "viem";
import { DEFAULT_CHAIN_ID, robinhoodChain } from "@/lib/chains";
import { PONS_FACTORY, ponsEscrowAbi, ponsFactoryAbi } from "@/lib/pons";
import Link from "next/link";

/**
 * The Overview tab's claimable card.
 *
 * The claimable figure comes from the escrow contract, read for the CONNECTED
 * wallet — not the profile's recorded address. The reason is not paranoia, it
 * is the contract's own rule: `claim()` pays the caller, so a figure read for
 * an address the browser is not holding would promise a claim that cannot be
 * made from here. When the connected wallet differs from the profile's wallet
 * the card says which address the number belongs to.
 *
 * Escrow address from the factory, never a constant: a wrong escrow reports
 * zero, which indistinguishable from "you have earned nothing".
 */
export function ClaimOverview({ wallet }: { wallet: string | null }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const { data: escrow, isError } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "feeEscrow",
  });

  const readAddress = address ?? wallet;
  const { data: claimable } = useReadContract({
    abi: ponsEscrowAbi,
    address: escrow,
    functionName: "balanceOf",
    args: readAddress ? [readAddress as `0x${string}`] : undefined,
    query: { enabled: Boolean(escrow) && Boolean(readAddress) },
  });

  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;
  const amount = claimable ?? 0n;
  const eth = trimEth(formatEther(amount));

  if (isError) {
    return (
      <p className="notice-dashed p-5">
        Couldn&apos;t read the fee escrow just now. Not a zero balance, a failed read. Try again shortly.
      </p>
    );
  }

  return (
    <section className="card grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-beg-dim">Claimable fees</span>
        <span className="text-[44px] font-extrabold leading-none tracking-[-.04em] text-beg-ink">
          {eth} <span className="text-[16px]">ETH</span>
        </span>
      </div>

      {readAddress && address !== undefined && readAddress !== address ? (
        <p className="text-[12px] text-beg-dim">
          That is the figure for the profile wallet ({short(readAddress)}). Connect it to act on it.
        </p>
      ) : null}

      {wrongChain ? (
        <button
          type="button"
          onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
          className="btn-primary w-full"
        >
          Switch to {robinhoodChain.name} to read live
        </button>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/fees" className="btn-primary px-5 py-2.5 text-[14px]">
          Fees and claiming
        </Link>
        {!isConnected ? (
          <span className="text-[12px] text-beg-dim self-center">
            Connect {wallet ? `your wallet (${short(wallet)})` : "a wallet"} to see your live claimable figure.
          </span>
        ) : null}
      </div>
    </section>
  );
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function trimEth(text: string): string {
  if (text === "0") return "0";
  if (text.includes(".")) {
    const [whole, frac] = text.split(".");
    if (Number(whole) >= 1) return `${whole}.${frac.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "");
    return `0.${frac.slice(0, 6).replace(/0+$/, "")}` || "0";
  }
  return text;
}
