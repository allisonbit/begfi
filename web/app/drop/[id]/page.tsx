import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DropClaimBox, type ClaimBoxState } from "@/components/drop-claim-box";
import { DropFundBox } from "@/components/drop-fund-box";
import { ShareButtons } from "@/components/share-buttons";
import { distributorAddressPublic } from "@/lib/campaigns";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { publicUrl } from "@/lib/config";
import { getDropById, getDropStats, getDropWinners, getMyDropClaim, dropIsOpen } from "@/lib/drops";
import { formatAmount } from "@/lib/erc20";
import { payoutWalletReady } from "@/lib/payout-controls";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/session";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

type Params = { id: string };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const drop = await getDropById(id);
  if (!drop) return { title: "Drop not found" };

  const prize = `${formatAmount(drop.amountPerClaim, drop.tokenDecimals)} ${drop.tokenSymbol}`;
  const description = drop.description ?? `${prize} to the first ${drop.maxClaims} claimers — paid straight to their wallets.`;

  return {
    title: `${drop.name} — a BegFi drop`,
    description,
    openGraph: { title: `${drop.name}: ${prize} per claim`, description, url: publicUrl(`/drop/${id}`) },
    // summary_large_image is the whole point of the drop card: a thumbnail-sized
    // prize line is unreadable in a group chat.
    twitter: { card: "summary_large_image", title: `${drop.name}: ${prize} per claim`, description },
  };
}

/**
 * /drop/[id] — one giveaway, and everything about it that can be proved.
 *
 * THE ORDER OF THE PAGE IS THE ORDER OF THE QUESTIONS a visitor has: what is
 * the prize, can I still get one, where is the pot, who already won. Every
 * figure comes from the deposit/payout ledger (`getDropStats`), and a read that
 * failed renders as "—" rather than as a zero — a pot that looks empty when it
 * is merely unreadable is the one lie a giveaway cannot survive.
 *
 * The claim box's state is decided HERE, on the server: signed out, no
 * username, already claimed, claimable, or not claimable with the reason. The
 * client component only renders it and posts one claim.
 */
export default async function DropPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const drop = await getDropById(id);
  if (!drop) notFound();

  const profile = await getProfile();
  const [stats, winners] = await Promise.all([getDropStats(drop), getDropWinners(drop.id, 50)]);
  const mine = profile ? await getMyDropClaim(drop.id, profile.wallet_address) : null;

  const owner = await dropOwner(drop.ownerId);
  const distributor = distributorAddressPublic();
  const payoutReady = await payoutWalletReady(drop.tokenAddress, drop.amountPerClaim);

  const prizeDisplay = formatAmount(drop.amountPerClaim, drop.tokenDecimals);
  const unit = (v: bigint | null) => (v === null ? "—" : formatAmount(v, drop.tokenDecimals));

  const claimState: ClaimBoxState = !SUPABASE_CONFIGURED
    ? { kind: "unavailable", reason: "Drops are not set up on this deployment yet." }
    : !profile
      ? { kind: "signed-out" }
      : !profile.username
        ? { kind: "no-username" }
        : mine
          ? { kind: "claimed", payoutTx: mine.payoutTx }
          : !dropIsOpen(drop)
            ? {
                kind: "unavailable",
                reason:
                  drop.status === "ended"
                    ? "This drop has ended. The winners it paid are listed below."
                    : drop.status === "paused"
                      ? "This drop is paused — the owner stopped new claims. Prizes already claimed are still paid."
                      : "This drop's claim window has closed.",
              }
            : !stats.pool
              ? { kind: "unavailable", reason: "The pot could not be read just now — try again in a moment." }
              : stats.prizesLeft === 0
                ? {
                    kind: "unavailable",
                    reason:
                      stats.claimCount !== null && stats.claimCount >= drop.maxClaims
                        ? `All ${drop.maxClaims} prizes have been taken.`
                        : "The pot is empty — every prize it could cover has been claimed. If the owner tops it up, more prizes open.",
                  }
                : !payoutReady
                  ? {
                      kind: "unavailable",
                      reason: "Payouts are briefly offline — the pool is being funded. Try again in a moment.",
                    }
                  : { kind: "claimable" };

  return (
    <div className="safe-x mx-auto grid max-w-[720px] gap-6 py-10">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[clamp(28px,6vw,44px)] font-extrabold leading-[1.05] tracking-[-.04em]">{drop.name}</h1>
            <p className="mt-1 text-[13px] text-beg-dim">
              a drop by{" "}
              {owner ? (
                <Link href={`/${owner}`} className="underline underline-offset-2 hover:text-beg-ink">
                  @{owner}
                </Link>
              ) : (
                "a BegFi user"
              )}
              {drop.status === "ended" ? " · ended" : drop.status === "paused" ? " · paused" : ""}
            </p>
          </div>
          <span className="rounded-full border-[3px] border-beg-ink bg-beg-lime px-4 py-2 text-[15px] font-extrabold text-beg-ink shadow-glow">
            {prizeDisplay} {drop.tokenSymbol} each
          </span>
        </div>
        {drop.description ? <p className="max-w-[65ch] text-[14px] text-beg-dim">{drop.description}</p> : null}
      </header>

      <section className="card grid gap-4">
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div>
            <div className="text-[22px] font-extrabold text-beg-ink">{prizeDisplay}</div>
            <div className="text-[11px] text-beg-dim">Prize per claim</div>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-beg-ink">{stats.prizesLeft ?? "—"}</div>
            <div className="text-[11px] text-beg-dim">Prizes left</div>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-beg-ink">
              {stats.claimCount ?? "—"}/{drop.maxClaims}
            </div>
            <div className="text-[11px] text-beg-dim">Claimed</div>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-beg-ink">
              {unit(stats.pool?.remaining ?? null)} {stats.pool ? drop.tokenSymbol : ""}
            </div>
            <div className="text-[11px] text-beg-dim">Still in the pot</div>
          </div>
        </div>

        <div className="progress">
          <div
            className="progress-fill"
            style={{
              width: `${
                stats.claimCount === null
                  ? 0
                  : Math.max(2, Math.min(100, Math.round((stats.claimCount / Math.max(1, drop.maxClaims)) * 100)))
              }%`,
            }}
          />
        </div>

        <DropClaimBox dropId={drop.id} prizeDisplay={prizeDisplay} symbol={drop.tokenSymbol} state={claimState} />
      </section>

      {/* The ledger, stated plainly — the numbers a claimer is entitled to ask about. */}
      <section className="notice">
        <b className="text-beg-ink">The pot, in full</b>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
          <li>
            Deposited: <b className="text-beg-ink">{unit(stats.pool?.deposited ?? null)}</b>
          </li>
          <li>
            Paid out: <b className="text-beg-ink">{unit(stats.pool?.paid ?? null)}</b>
          </li>
          <li>
            Promised: <b className="text-beg-ink">{unit(stats.pool?.promised ?? null)}</b>
          </li>
          <li>
            Claimable now: <b className="text-beg-ink">{unit(stats.pool?.available ?? null)}</b>
          </li>
        </ul>
        <p className="mt-2 text-[12px]">
          &ldquo;Promised&rdquo; is prizes whose transfer has not confirmed yet — a claim is paid in full or refused, never queued behind an
          empty pot. {drop.closesAt ? `The window closes ${new Date(drop.closesAt).toLocaleString("en-GB")}.` : "No deadline: the drop runs until the prizes run out."}
        </p>
        <p className="mt-2 text-[12px]">
          Prize token{" "}
          <a href={addressUrl(drop.tokenAddress)} target="_blank" rel="noreferrer noopener" className="font-mono underline underline-offset-2 hover:text-beg-ink">
            {shortAddress(drop.tokenAddress)} ↗
          </a>
        </p>
      </section>

      {/* Fund it — for anyone signed in, not only the owner. */}
      {profile && profile.username && drop.status === "open" && distributor ? (
        <section className="card">
          <DropFundBox
            dropId={drop.id}
            tokenAddress={drop.tokenAddress}
            tokenDecimals={drop.tokenDecimals}
            tokenSymbol={drop.tokenSymbol}
            prizeDisplay={prizeDisplay}
            distributorAddress={distributor}
            funderWallet={profile.wallet_address}
          />
        </section>
      ) : null}

      <section className="grid gap-2">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Winners</h2>
        {winners.length === 0 ? (
          <p className="notice-dashed">
            Nobody has been paid yet.{" "}
            {stats.isClaimable ? "The first claim is still out there." : "This drop has not paid a prize yet."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {winners.map((claim) => (
              <li key={claim.id} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <Link href={`/${claim.username}`} className="font-bold text-beg-ink underline underline-offset-2">
                  @{claim.username}
                </Link>
                <span className="font-bold text-beg-ink">
                  {formatAmount(claim.amount, drop.tokenDecimals)} {drop.tokenSymbol}
                </span>
                {claim.payoutTx ? (
                  <a href={txUrl(claim.payoutTx)} target="_blank" rel="noreferrer noopener" className="font-mono text-[11px] text-beg-dim underline underline-offset-2">
                    {shortAddress(claim.payoutTx)} ↗
                  </a>
                ) : null}
                <span className="text-[11px] text-beg-dim">{new Date(claim.createdAt).toLocaleDateString("en-GB")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShareButtons
        url={publicUrl(`/drop/${drop.id}`)}
        text={`${prizeDisplay} ${drop.tokenSymbol} to the first claimers — ${drop.name} on BegFi`}
        caption="Posting the link is how a pot gets emptied: the first people to open it can claim."
      />

      <p className="text-[12px] text-beg-dim">
        Prizes are paid on-chain from the BegFi payout wallet, automatically, to the wallet that claimed. One prize per wallet and per
        verified X account. Nothing here is financial advice, and BegFi is not affiliated with Robinhood.
      </p>
    </div>
  );
}

/** The owner's username, for the credit line. Public data only. */
async function dropOwner(ownerId: string): Promise<string | null> {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    const sb = await createClient();
    const { data } = await sb.from("profiles").select("username").eq("id", ownerId).maybeSingle<{ username: string }>();
    return data?.username ?? null;
  } catch {
    return null;
  }
}
