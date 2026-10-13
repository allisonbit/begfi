import type { Metadata } from "next";

import { ReviewActions, SettingsForm } from "@/components/earn-review-actions";
import { shortAddress } from "@/lib/chains";
import { getEarnSettings, isAdminWallet, listPendingSubmissions, rewardDisplay } from "@/lib/earn";
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

  const [settings, pending] = await Promise.all([getEarnSettings(), listPendingSubmissions()]);

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
          dailyLimit={settings.dailyLimit}
          poolTotalDisplay={paymentDisplay(settings.poolTotal)}
          poolRemainingDisplay={paymentDisplay(settings.poolRemaining)}
          isActive={settings.isActive}
        />
      ) : (
        <p className="notice-dashed p-5">Earn settings couldn&apos;t be read. Check the database.</p>
      )}

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
