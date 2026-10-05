import type { Metadata } from "next";
import Link from "next/link";
import { ShareButtons } from "@/components/share-buttons";
import { publicUrl } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getRecentBegs } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Begs",
  description: "What people are begging for on BegFi, and how far along they are.",
};

/** Re-read every couple of minutes rather than on every request. */
export const revalidate = 120;

/**
 * Every beg, newest first.
 *
 * PUBLIC, AND DELIBERATELY SO. A beg is an ask, and an ask nobody can see is not
 * an ask. This is the page a person shares when they want a whole feed of things
 * to help with rather than one link — and it is where someone deciding whether
 * BegFi is alive can see that it is.
 *
 * Progress comes from the same aggregate the individual beg pages use, for the
 * same reason: a signed-out visitor cannot read `transfers`, so a feed that
 * summed them itself would show zero against every beg on it.
 */
export default async function BegsPage() {
  const begs = await getRecentBegs(30);

  return (
    <div className="mx-auto grid max-w-[760px] gap-6 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Begs</h1>
          <p className="mt-1 text-beg-dim">What people are asking for, and how close they are.</p>
        </div>
        <Link href="/dashboard" className="rounded-full bg-beg-lime px-5 py-3 text-[14px] font-bold text-beg-bg">
          Write a beg
        </Link>
      </header>

      {begs.length === 0 ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
          No begs yet. The first one will appear here the moment someone writes it.
        </p>
      ) : (
        <ul className="grid gap-4">
          {begs.map((beg) => {
            const goal = beg.goal ? BigInt(beg.goal) : null;
            const raised = BigInt(beg.raised);
            const filled = goal !== null && goal > 0n && raised >= goal;
            const pct =
              goal && goal > 0n ? Math.min(100, Number((raised * 10_000n) / goal) / 100) : 0;
            const who = beg.display_name ?? `@${beg.username}`;
            const url = publicUrl(`/beg/${beg.id}`);

            return (
              <li
                key={beg.id}
                className="grid gap-4 rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-5"
              >
                <div className="flex items-center gap-3">
                  {beg.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={beg.avatar_url} alt="" className="size-10 rounded-full object-cover" />
                  ) : (
                    <div className="grid size-10 place-items-center rounded-full bg-beg-lime text-lg font-extrabold text-beg-bg">
                      {who[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-beg-ink">{who}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-beg-dim">
                      <Link href={`/${beg.username}`} className="hover:text-beg-ink">
                        @{beg.username}
                      </Link>
                      {/*
                        The X handle is shown as a link out because that is what
                        it is for: a beg is usually raised by someone with a
                        following, and the person deciding whether to help wants
                        to know who they are dealing with.
                      */}
                      {beg.x_handle ? (
                        <>
                          <span aria-hidden>·</span>
                          <a
                            href={`https://x.com/${beg.x_handle}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:text-beg-ink"
                          >
                            @{beg.x_handle} on X
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <Link href={`/beg/${beg.id}`} className="text-[19px] font-bold leading-snug text-beg-ink">
                  {beg.body}
                </Link>

                {goal !== null && goal > 0n ? (
                  <div className="grid gap-2">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="font-bold text-beg-lime">{formatAmount(raised)} $BEG</span>
                      <span className="text-beg-dim">of {formatAmount(goal)}</span>
                    </div>
                    <div
                      className="h-2.5 overflow-hidden rounded-full bg-beg-bg"
                      role="progressbar"
                      aria-valuenow={Math.round(pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Progress toward ${who}'s goal`}
                    >
                      <div className="h-full rounded-full bg-beg-lime" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[12px] text-beg-dim">
                      {filled ? "Filled — anything more still lands in their wallet." : `${pct.toFixed(1)}% of the way there`}
                    </span>
                  </div>
                ) : (
                  <span className="text-[12px] text-beg-dim">Open-ended — any amount helps.</span>
                )}

                {/* Share this one beg, from the feed, without opening it first. */}
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`https://x.com/intent/post?text=${encodeURIComponent(beg.body)}&url=${encodeURIComponent(url)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-[13px] font-bold text-beg-ink transition-colors hover:border-beg-lime"
                  >
                    Post to X
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(beg.body)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-[13px] text-beg-dim transition-colors hover:border-beg-lime hover:text-beg-ink"
                  >
                    Telegram
                  </a>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(beg.body)}%20${encodeURIComponent(url)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-[13px] text-beg-dim transition-colors hover:border-beg-lime hover:text-beg-ink"
                  >
                    WhatsApp
                  </a>
                  <Link
                    href={`/${beg.username}`}
                    className="rounded-full bg-beg-lime px-4 py-2 text-[13px] font-bold text-beg-bg"
                  >
                    Send $BEG
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ShareButtons url={publicUrl("/begs")} text="People are begging on BegFi" />

      <p className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px] text-beg-dim">
        Anyone can write a beg here and BegFi does not check any of them. Give to people you know or
        have reason to trust — nothing on this page is verified, and a blockchain send cannot be
        undone.
      </p>
    </div>
  );
}
