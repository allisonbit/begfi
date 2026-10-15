import type { Metadata } from "next";

import { CampaignForm } from "@/components/campaign-form";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import { distributorAddressPublic, getOwnerCampaigns } from "@/lib/campaigns";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Your campaigns" };
export const dynamic = "force-dynamic";

/**
 * The project dashboard.
 *
 * The owner sees the ledger truth for every campaign they run: pool, paid,
 * days of budget left, submissions with verification verdicts, the day's top
 * posters, and the payout rows with explorer links. The funded address is
 * THE distributor wallet — the same wallet BegFi's own pool pays from — and
 * the top-up box prints it with a copy-ready address because "fund it"
 * without the exact address is a promise, not a step.
 */
export default async function CampaignsDashboardPage() {
  const profile = await getProfile();
  if (!profile) return null; // the dashboard layout already gates this

  const views = await getOwnerCampaigns(profile.id);
  const distributor = distributorAddressPublic();

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(26px,5vw,36px)] font-extrabold tracking-[-.05em]">Your campaigns</h1>
          <p className="mt-1 text-beg-dim">Run an earn campaign for your own project. You fund the pool; BegFi pays it out automatically, every day.</p>
        </div>
        {!distributor ? null : (
          <div className="card-sm grid gap-1 p-4 text-[12px]">
            <b className="text-beg-ink">Top-up address</b>
            <a href={addressUrl(distributor)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
              {shortAddress(distributor)} ↗
            </a>
            <span className="max-w-[240px] break-all text-[11px] text-beg-dim">{distributor}</span>
            <span className="text-[11px] text-beg-dim">Send your token here — deposits are credited automatically.</span>
          </div>
        )}
      </header>

      {views.length === 0 ? (
        <section className="mt-6 grid gap-4">
          <p className="notice-dashed p-5">
            No campaigns yet. Create one, send its token to the distributor address, and the pool starts paying the moment the deposit
            confirms on-chain.
          </p>
          <CampaignForm />
        </section>
      ) : (
        <>
          <section className="mt-5 grid gap-4">
            <CampaignForm />
          </section>
          {views.map((view) => {
            const { campaign, submissions, topPosters, payouts } = view;
            const poolLeft = view.poolRemaining < 0n ? 0n : view.poolRemaining;
            const daysLeft = campaign.dailyBudget > 0n ? Number(poolLeft / campaign.dailyBudget) : null;
            const progress =
              view.poolTotal > 0n ? Math.max(2, Math.min(100, Number((poolLeft * 100n) / view.poolTotal))) : 0;
            const unit = (v: bigint) => formatAmount(v, campaign.tokenDecimals);

            return (
              <section key={campaign.id} className="mt-6 grid gap-3">
                <div className="card grid gap-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {campaign.logoUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={campaign.logoUrl} alt="" className="size-10 rounded-xl border-[1.5px] border-beg-line object-cover" />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-xl border-[1.5px] border-beg-line bg-beg-card text-[12px] font-extrabold text-beg-ink">
                          {campaign.tokenSymbol.slice(0, 3)}
                        </span>
                      )}
                      <div>
                        <b className="text-[16px] text-beg-ink">
                          {campaign.name}{" "}
                          <span className={`align-middle text-[10px] font-bold uppercase tracking-[.06em] text-beg-dim`}>· {campaign.status}</span>
                        </b>
                        <a href={`/earn/${campaign.slug}`} className="block text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                          /earn/{campaign.slug} ↗
                        </a>
                      </div>
                    </div>
                    {campaign.isVerified ? (
                      <span className="rounded-full border-2 border-beg-ink bg-beg-lime px-2.5 py-0.5 text-[11px] font-extrabold text-beg-ink">✓ verified</span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                    <div>
                      <div className="text-[20px] font-extrabold text-beg-ink">{unit(poolLeft)}</div>
                      <div className="text-[11px] text-beg-dim">Pool left</div>
                    </div>
                    <div>
                      <div className="text-[20px] font-extrabold text-beg-ink">{unit(view.totalPaid)}</div>
                      <div className="text-[11px] text-beg-dim">Total paid out</div>
                    </div>
                    <div>
                      <div className="text-[20px] font-extrabold text-beg-ink">{daysLeft === null ? "—" : daysLeft}</div>
                      <div className="text-[11px] text-beg-dim">Days of payouts left</div>
                    </div>
                    <div>
                      <div className="text-[20px] font-extrabold text-beg-ink">{view.participants}</div>
                      <div className="text-[11px] text-beg-dim">Participants</div>
                    </div>
                  </div>

                  <div className="grid gap-1">
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-[11px] text-beg-dim">
                      {formatAmount(poolLeft, campaign.tokenDecimals)} {campaign.tokenSymbol} remaining · {formatAmount(campaign.dailyBudget, campaign.tokenDecimals)}/day required tag:{" "}
                      <code className="rounded bg-beg-card px-1 font-bold text-beg-ink">{campaign.requiredEntry}</code>
                    </p>
                  </div>
                </div>

                {/* Top posters */}
                {topPosters.length > 0 ? (
                  <div className="card-sm p-4">
                    <b className="text-[14px] text-beg-ink">Top posters this campaign</b>
                    <ul className="mt-2 grid gap-1.5">
                      {topPosters.map((p, i) => (
                        <li key={p.wallet_address} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-[11px] text-beg-dim">#{i + 1}</span>
                            <b className="truncate text-beg-ink">@{p.username}</b>
                          </span>
                          <span className="text-[12px] text-beg-dim">{p.count} post{p.count === 1 ? "" : "s"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Submission ledger (validation + payment states) */}
                <div className="card-sm p-4">
                  <b className="text-[14px] text-beg-ink">Submissions</b>
                  {submissions.length === 0 ? (
                    <p className="mt-2 text-[12px] text-beg-dim">No submissions yet.</p>
                  ) : (
                    <ul className="mt-2 grid gap-1.5">
                      {submissions.slice(0, 20).map((s, i) => (
                        <li key={`${s.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                          <a href={s.post_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                            {s.post_url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                          <b className="text-beg-ink">@{s.username}</b>
                          <span
                            className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${
                              s.status === "valid" ? (s.payout_tx ? "bg-beg-lime" : "bg-beg-yellow") : "bg-beg-card"
                            }`}
                          >
                            {s.status === "valid" ? (s.payout_tx ? "paid" : "sharing") : "rejected"}
                          </span>
                          {s.verify_note ? <span className="max-w-[200px] truncate text-[11px] text-beg-dim" title={s.verify_note}>{s.verify_note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Payout history */}
                {payouts.length > 0 ? (
                  <div className="card-sm p-4">
                    <b className="text-[14px] text-beg-ink">Automatic payouts</b>
                    <ul className="mt-2 grid gap-1.5">
                      {payouts.slice(0, 10).map((p, i) => (
                        <li key={`${p.tx_hash ?? "notx"}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <b className="text-beg-ink">@{p.username ?? shortAddress(p.wallet_address)}</b>
                            <span className="font-bold text-beg-ink">
                              {formatAmount(BigInt(p.amount), campaign.tokenDecimals)} {campaign.tokenSymbol}
                            </span>
                            <span className="text-[11px] text-beg-dim">· cycle {p.cycle_date}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${p.status === "sent" ? "bg-beg-lime" : p.status === "pending" ? "bg-beg-yellow" : "bg-beg-card"}`}>
                              {p.status}
                            </span>
                            {p.tx_hash ? (
                              <a href={txUrl(p.tx_hash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2">
                                {shortAddress(p.tx_hash)} ↗
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
