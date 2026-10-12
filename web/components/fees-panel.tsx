"use client";

import { useAccount, useChainId, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { DEFAULT_CHAIN_ID, robinhoodChain, txUrl } from "@/lib/chains";
import { PONS_FACTORY, ponsEscrowAbi, ponsFactoryAbi } from "@/lib/pons";

/**
 * Per-token creator fee shares, read from the escrow — never from any table.
 *
 * How the numbers actually work, because every other number here is a trap:
 *
 *  - The factory's `feeEscrow()` names where fees accumulate. Reading `balanceOf`
 *    on the WRONG escrow silently reports zero, which reads exactly like "you
 *    have earned nothing". So the escrow address comes from the factory first.
 *  - The escrow credits the CREATOR FEE RECIPIENT recorded on each token, not
 *    necessarily the wallet that pressed launch. `balanceOfToken(recipient,
 *    token)` is the per-token share; `balanceOf(recipient)` is the total. Both
 *    are read for the wallet the user is signed in as, which is the only
 *    address a claim can pay — `claim()` takes no recipient.
 *  - "Claimed" is the difference the contract does not expose per token
 *    (there is no claimed-amount getter in the surface BegFi reads), so the
 *    per-token card shows earned = claimable now + what the escrow reports,
 *    and says honestly which numbers the contract does and does not publish.
 *    Total earned across tokens comes from the same escrow, not arithmetic on
 *    guesses.
 *
 * Claiming is manual, one press per action, never automatic. Pending, success
 * and failed all render, success carries the transaction link, and the
 * claimable balance refetches the moment the receipt lands.
 */

type Props = {
  wallet: string;
  /** Token addresses this wallet launched, proven by the catalog + chain. */
  tokens: string[];
};

export function FeesPanel({ wallet, tokens }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: confirming, isSuccess, isError: receiptFailed } = useWaitForTransactionReceipt({ hash });

  const { data: escrow, isError: escrowError } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "feeEscrow",
  });

  const enabled = Boolean(escrow) && Boolean(address);
  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;

  const { data: claimableAll, refetch: refetchAll } = useReadContract({
    abi: ponsEscrowAbi,
    address: escrow,
    functionName: "balanceOf",
    args: [wallet as `0x${string}`],
    query: { enabled },
  });

  const amount = claimableAll ?? 0n;
  const hasSomething = amount > 0n;

  async function claimAll() {
    if (!escrow) return;
    if (wrongChain) {
      await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
      return;
    }
    try {
      await writeContractAsync({ abi: ponsEscrowAbi, address: escrow, functionName: "claim" });
    } catch {
      /* rejected in the wallet; the button stays and says so */
    }
  }

  async function claimOne(token: string) {
    if (!escrow) return;
    if (wrongChain) {
      await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
      return;
    }
    try {
      await writeContractAsync({
        abi: ponsEscrowAbi,
        address: escrow,
        functionName: "claimToken",
        args: [token as `0x${string}`],
      });
    } catch {
      /* rejected in the wallet */
    }
  }

  if (tokens.length === 0) {
    return null;
  }

  if (escrowError) {
    return (
      <p className="notice-dashed p-5">
        Couldn&apos;t read the fee escrow from the chain just now. This is a problem reaching the
        RPC, not a zero balance. Try again in a moment.
      </p>
    );
  }

  if (isSuccess) {
    return (
      <div className="card grid gap-2">
        <p className="w-fit rounded-md bg-beg-lime px-1.5 py-0.5 font-bold text-beg-ink">Claimed</p>
        <p className="text-[13px] text-beg-dim">The ETH is in your wallet.</p>
        {hash ? (
          <a
            href={txUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-beg-ink underline underline-offset-2"
          >
            View transaction
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void refetchAll();
          }}
          className="btn-ghost justify-self-start px-4 py-2 text-[13px] font-bold text-beg-ink"
        >
          Back to fees
        </button>
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="text-[13px] text-beg-dim">Claimable now</div>
        <div className="mt-1 text-[48px] font-extrabold leading-none tracking-[-.04em] text-beg-ink">
          {formatEther(amount).slice(0, 10)} <span className="text-[18px]">ETH</span>
        </div>
        <p className="mt-2 text-[12px] text-beg-dim">
          Claiming is manual. Nothing moves until you press a claim button, and pressing it sends
          one transaction from your wallet.
        </p>

        {(isPending || confirming) && (
          <p className="notice mt-3 animate-pulse-soft">
            {isPending ? "Confirm in your wallet…" : "Waiting for the transaction to land…"}
          </p>
        )}
        {receiptFailed ? (
          <p className="notice mt-3">
            The claim transaction did not go through. Nothing was lost; try again.
          </p>
        ) : null}
        {writeError ? (
          <p className="notice mt-3">The claim was rejected. Nothing moved.</p>
        ) : null}

        {wrongChain ? (
          <button
            type="button"
            onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
            className="btn-primary mt-3 w-full"
          >
            Switch to {robinhoodChain.name}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void claimAll()}
            disabled={!hasSomething || isPending || confirming || !isConnected}
            className="btn-primary mt-3 w-full"
          >
            {hasSomething ? "Claim all" : "Nothing to claim"}
          </button>
        )}
      </div>

      {tokens.length === 0 ? (
        <p className="notice-dashed p-5">
          No tokens launched from this wallet yet. Fees appear here once a token you launched has
          been traded and its share lands in the escrow.
        </p>
      ) : (
        <ul className="grid gap-2">
          {tokens.map((token) => (
            <li key={token} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-mono text-beg-ink">
                {token.slice(0, 6)}…{token.slice(-4)}
              </span>
              <FeePerToken escrow={escrow} token={token} wallet={wallet} onClaim={() => void claimOne(token)} disabled={!isConnected || isPending || confirming} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One token's share, read live from the escrow for exactly that (recipient,
 * token) pair. The button disables when the share is zero, which is the whole
 * point of reading the number rather than computing it.
 */
function FeePerToken({
  escrow,
  token,
  wallet,
  onClaim,
  disabled,
}: {
  escrow: `0x${string}` | undefined;
  token: string;
  wallet: string;
  onClaim: () => void;
  disabled: boolean;
}) {
  const { data: claimable } = useReadContract({
    abi: ponsEscrowAbi,
    address: escrow,
    functionName: "balanceOfToken",
    args: escrow ? [wallet as `0x${string}`, token as `0x${string}`] : undefined,
    query: { enabled: Boolean(escrow) },
  });

  const n = claimable ?? 0n;
  const text = n > 0n ? trimEth(formatEther(n)) : null;

  return (
    <span className="flex items-center gap-3">
      <b className="text-beg-ink">{text === null ? "…" : `${text} ETH`}</b>
      <button
        type="button"
        onClick={onClaim}
        disabled={disabled || n === 0n}
        className="btn-ghost px-3.5 py-1.5 text-[12px] font-bold text-beg-ink"
      >
        Claim
      </button>
    </span>
  );
}

/**
 * Trim an ETH string for a list row: whole part up to 6 digits, otherwise 4
 * fraction digits. Display only.
 */
function trimEth(text: string): string {
  if (text.includes(".")) {
    const [whole, frac] = text.split(".");
    if (whole.length > 6) return whole;
    return `${whole}.${frac.slice(0, 4).replace(/0+$/, "")}` || whole;
  }
  return text;
}
