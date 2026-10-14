import type { Metadata } from "next";

import { ReviewActions, SettingsForm } from "@/components/earn-review-actions";
import { shortAddress } from "@/lib/chains";
import { getEarnSettings, getPayoutLedger, isAdminWallet, listPendingSubmissions, rewardDisplay } from "@/lib/earn";
import { txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Earn review" };
export const dynamic = "force-dynamic";

/**
 * The Earn Review tab — the admin console.
 *
 * The gate is the session's wallet against the admin allowlist, checked on the
 * SERVER before this renders and re-checked by every route these buttons call.
 * A non-admin who follows the URL sees exactly what a visitor with no account
 * would see: a refusal, not an empty console.
 */
export default async function EarnReviewPage() {
  const profile = await getProfile();

  /* The dashboard layout already requires a session; this re-checks the role. */
  const admin = profile?.wallet_address ? isAdminWallet(profile.wallet_address) : false;
  if (!profile || !admin) {
    return (
      <div className="card grid gap-2 p-6">
        <b className="text-[16px] text-beg-ink">Not authorized</b>
        <p className="text-[13px] text-beg-dim">
          This console runs for the admin wallet only. Sign in with it and come back.
        </p>
      </div>
    );
  }

  const [settings, pending, ledger] = await Promise.all([
    getEarnSettings(),
    listPendingSubmissions(),
    getPayoutLedger(50),
  ]);

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Earn review</h1>
        <p className="mt-1 text-beg-dim">
          Pending submissions. Approving makes the reward claimable and moves it out of the pool.
        </p>
      </header>

      {settings ? (
        <SettingsForm
          rewardPerPostDisplay={rewardDisplay(settings.rewardPerPost)}
          poolTotalDisplay={paymentDisplay(settings.poolTotal)}
          poolRemainingDisplay={paymentDisplay(settings.poolRemaining)}
          isActive={settings.isActive}
        />
      ) : (
        <p className="notice-dashed p-5">Earn settings couldn&apos;t be read. Check the database.</p>
      )}

      {/*
        The payout ledger. Three states only, from the same row the claim
        path writes: paid (tx recorded), sending (staged, tx pending), and
        waiting (approve-to-payout path was interrupted). Clicking a tx
        opens the explorer — an audit panel that cannot link out is a list
        of promises.
      */}
      <section>
        <h2 className="mb-1 text-xl font-extrabold tracking-[-.03em]">
          Payout ledger ({ledger.length})
        </h2>
        <p className="mb-3 text-[12px] text-beg-dim">Every claimable submission, newest first. "Paid" links to the transfer that settled it.</p>
        {ledger.length === 0 ? (
          <p className="notice-dashed">No payouts recorded yet. Rows appear the moment a submission becomes claimable.</p>
        ) : (
          <ul className="grid gap-2">
            {ledger.map((row) => {
              const state =
                row.payout_tx ? "paid" : row.claimed_at ? "sending" : "waiting";
              return (
                <li key={row.id} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-bold text-beg-ink">@{row.username}</span>
                    <span className="font-mono text-[11px] text-beg-dim" title={row.wallet_address}>
                      {shortAddress(row.wallet_address)}
                    </span>
                    <span className="font-bold text-beg-ink">{formatAmount(BigInt(row.reward_amount))} $BEGFI</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${
                        state === "paid" ? "bg-beg-lime" : state === "sending" ? "bg-beg-yellow" : "bg-beg-card"
                      }`}
                    >
                      {state}
                    </span>
                    {row.payout_tx ? (
                      <a href={txUrl(row.payout_tx)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                        {shortAddress(row.payout_tx)} ↗
                      </a>
                    ) : (
                      <span className="text-[11px] text-beg-dim">
                        {new Date(row.created_at).toLocaleDateString("en-GB")}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="notice-dashed">Nothing waiting for review. When posts arrive, they land here with their link, username and wallet.</p>
        ) : (
          <ul className="grid gap-2">
            {pending.map((row) => (
              <li key={row.id} className="card-sm grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <b className="text-beg-ink">@{row.username}</b>
                    <span className="font-mono text-[12px] text-beg-dim" title={row.wallet_address}>
                      {shortAddress(row.wallet_address)}
                    </span>
                    <span className="font-bold text-beg-ink">{formatAmount(BigInt(row.reward_amount))} $BEGFI</span>
                  </div>
                  <a href={row.post_url} target="_blank" rel="noreferrer noopener" className="truncate text-[13px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                    {row.post_url}
                  </a>
                  <span className="text-[11px] text-beg-dim">
                    {new Date(row.created_at).toLocaleString("en-GB")}
                  </span>
                </div>
                <ReviewActions id={row.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function paymentDisplay(wei: bigint): string {
  return (wei / 10n ** 18n).toLocaleString("en-GB");
}
