import type { Metadata } from "next";
import Link from "next/link";
import { ShareButtons } from "@/components/share-buttons";
import { publicUrl } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getRecentBegs, type PublicBeg } from "@/lib/queries";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

export const metadata: Metadata = {
  title: "Begs",
  description: "What people are begging for on BegFi, and how far along they are.",
};

/**
 * Revalidate the feed every couple of minutes.
 *
 * Belt and braces, and honestly the belt does nothing today: the read runs
 * through the caller's session (supabase/server awaits `cookies()`), which
 * opts the route into dynamic rendering — so the feed is re-rendered on every
 * request, fresher than this ceiling. The line stays so that if the session
 * read ever moves out of this page, the route falls into sane periodic
 * revalidation instead of a build-time snapshot.
 */
export const revalidate = 120;

/**
 * How the feed came back. Three states that must never be confused:
 *
 * - "ok" — the read worked, whether any begs came back or not.
 * - "unconfigured" — no database is attached to this deployment at all.
 * - "error" — the read itself failed.
 *
 * The last two render differently on purpose. Saying "no begs yet" for a broken
 * read is the one lie a feed must not tell: it looks like an empty product
 * rather than a broken query, and it is exactly the lie `getRecentBegs` used to
 * tell before it started throwing.
 */
type Feed =
  | { kind: "ok"; begs: PublicBeg[] }
  | { kind: "unconfigured" }
  | { kind: "error" };

async function loadFeed(): Promise<Feed> {
  if (!SUPABASE_CONFIGURED) return { kind: "unconfigured" };

  try {
    return { kind: "ok", begs: await getRecentBegs(30) };
  } catch {
    return { kind: "error" };
  }
}

/**
 * A short age for the feed, computed on the server, once per render.
 *
 * Begs age badly: progress is counted from confirmed transfers since the beg
 * was written, so how long ago that was is part of what the number means. The
 * age becomes a real date after forty-five days, where "some weeks ago" stops
 * carrying information.
 *
 * The page renders per request, so the age is as fresh as the visit; what
 * lags is the indexer behind the progress total, and the caption under the
 * list says so plainly.
 */
function age(created: string): string {
  const written = new Date(created).getTime();
  const minutes = Math.max(1, Math.round((Date.now() - written) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d ago`;
  return new Date(created).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The most recent begs, newest first.
 *
 * PUBLIC, AND DELIBERATELY SO. A beg is an ask, and an ask nobody can see is not
 * an ask. This is the page a person shares when they want a whole feed of things
 * to help with rather than one link — and it is where someone deciding whether
 * BegFi is alive can see that it is.
 *
 * Progress comes from the same aggregate the individual beg pages use, for the
 * same reason: a signed-out visitor cannot read `transfers`, so a feed that
 * summed them itself would show zero against every beg on it. And when that
 * aggregate cannot be read, the feed says so per beg rather than showing a
 * confident zero — the same honesty the individual page has.
 */
export default async function BegsPage() {
  const feed = await loadFeed();

  return (
    <div className="safe-x mx-auto grid max-w-[760px] gap-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Begs</h1>
          <p className="mt-1 text-beg-dim">What people are asking for, and how close they are.</p>
        </div>
        <Link href="/dashboard" className="btn-primary">
          Write a beg
        </Link>
      </header>

      {feed.kind === "ok" && feed.begs.length === 0 ? (
        <p className="notice p-5">No begs yet. The first one written will appear here.</p>
      ) : null}

      {feed.kind === "unconfigured" ? (
        <p className="notice-dashed p-5">
          The database isn&apos;t connected on this deployment yet, so there is no feed to show.
          This is a missing connection, not an empty product.
        </p>
      ) : null}

      {feed.kind === "error" ? (
        <p className="notice-dashed p-5">
          The feed couldn&apos;t be read just now — that&apos;s a problem reaching the database, not
          an empty product. Try again in a moment.
        </p>
      ) : null}

      {feed.kind === "ok" && feed.begs.length > 0 ? (
        <>
          <p className="text-[12px] text-beg-dim">
            Newest first{feed.begs.length >= 30 ? " — the latest 30 shown" : ""}.
          </p>
          <ul className="grid gap-4">
            {feed.begs.map((beg) => {
              const goal = beg.goal ? BigInt(beg.goal) : null;
              const raised = BigInt(beg.raised);
              const filled = goal !== null && goal > 0n && raised >= goal;
              const pct =
                goal && goal > 0n ? Math.min(100, Number((raised * 10_000n) / goal) / 100) : 0;
              /*
               * The display name is optional in the database and only checked for
               * a maximum length, so it can exist and still be empty. The
               * fallback has to catch that too, or a beg renders with no name
               * and an initial taken from nothing.
               */
              const name = beg.display_name?.trim() || beg.username;
              const who = beg.display_name?.trim() ? beg.display_name : `@${beg.username}`;
              const initial = name[0]?.toUpperCase() ?? "?";
              const url = publicUrl(`/beg/${beg.id}`);

              return (
                <li
                  key={beg.id}
                  className="card grid animate-fade-rise gap-4"
                >
                  <div className="flex items-center gap-3">
                    {beg.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={beg.avatar_url} alt="" className="size-10 rounded-full object-cover" />
                    ) : (
                      <div className="grid size-10 place-items-center rounded-full bg-beg-lime text-lg font-extrabold text-beg-bg">
                        {initial}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-beg-ink">{who}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-beg-dim">
                        <Link href={`/${beg.username}`} className="hover:text-beg-ink">
                          @{beg.username}
                        </Link>
                        <span aria-hidden>·</span>
                        <time dateTime={beg.created_at} className="whitespace-nowrap">
                          {age(beg.created_at)}
                        </time>
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
                    beg.progressKnown ? (
                      <div className="grid gap-2">
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="font-bold text-beg-lime">{formatAmount(raised)} $BEG</span>
                          <span className="text-beg-dim">of {formatAmount(goal)} $BEG</span>
                        </div>
                        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress toward ${who}'s goal`}>
                          <div className="progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[12px] text-beg-dim">
                          {filled
                            ? "Filled. Anything more still lands in their wallet."
                            : `${pct.toFixed(1)}% of the way there`}
                        </span>
                      </div>
                    ) : (
                      /*
                       * Same line the individual beg page shows when its
                       * aggregate read fails. Progress that cannot be read must
                       * never render as a confident zero.
                       */
                      <span className="text-[12px] text-beg-dim">
                        Couldn&apos;t read the total just now — that&apos;s a problem reaching the
                        chain, not a zero.
                      </span>
                    )
                  ) : (
                    <span className="text-[12px] text-beg-dim">Open-ended — any amount helps.</span>
                  )}

                  {/* Share this one beg, from the feed, without opening it first. */}
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`https://x.com/intent/post?text=${encodeURIComponent(beg.body)}&url=${encodeURIComponent(url)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink"
                    >
                      Post to X
                    </a>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(beg.body)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-ghost px-4 py-2 text-[13px] text-beg-dim hover:text-beg-ink"
                    >
                      Telegram
                    </a>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(beg.body)}%20${encodeURIComponent(url)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-ghost px-4 py-2 text-[13px] text-beg-dim hover:text-beg-ink"
                    >
                      WhatsApp
                    </a>
                    <Link
                      href={`/${beg.username}`}
                      className="btn-primary px-4 py-2 text-[13px]"
                    >
                      Send $BEG
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-beg-dim">
            Ages count from when each beg was written, and progress is counted from confirmed
            transfers — a fresh send takes a little while to show.
          </p>
        </>
      ) : null}

      <ShareButtons
        url={publicUrl("/begs")}
        text="People are begging on BegFi"
        caption="Each beg carries its own image; the feed is just the list."
      />

      <p className="notice">
        Anyone can write a beg here and BegFi does not check any of them. Give to people you know or
        have reason to trust — nothing on this page is verified, and a blockchain send cannot be
        undone.
      </p>
    </div>
  );
}
