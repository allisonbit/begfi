import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SendPanel } from "@/components/send-panel";
import { RobinhoodFeather } from "@/components/robinhood-feather";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, USERNAME_PATTERN, isReserved } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getProfileByUsername, getSupporterList } from "@/lib/queries";
import { isTopBeggar } from "@/lib/battles";
import { getActivityFeed } from "@/lib/dashboard";
import { getLevelForWallet } from "@/lib/level";
import { LevelChip } from "@/components/level-chip";
import { QRShare } from "@/components/qr-share";

type Params = { username: string };

/**
 * Always rendered per request. The totals on this page come from the indexer,
 * so a cached copy would show a stale amount after a send has been confirmed —
 * which is the one number a visitor is looking at.
 */
export const dynamic = "force-dynamic";

/**
 * The public page: `/username`.
 *
 * Server-rendered, which is the entire reason this app is Next.js rather than a
 * client-rendered SPA (spec §8). A client app hands a crawler an empty shell, so
 * a BegFi link posted to X, Telegram or WhatsApp would preview as a blank card.
 * Here the profile is fetched on the server and `generateMetadata` turns it into
 * real Open Graph tags, with no bot-detection Edge Function needed.
 */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username } = await params;
  const found = await getProfileByUsername(username);

  if (!found) return { title: "Not found" };

  const name = found.profile.display_name ?? `@${found.profile.username}`;
  const description = found.profile.bio ?? `Send ${name} some $BEGFI on Robinhood Chain.`;

  return {
    title: name,
    description,
    openGraph: {
      title: name,
      description,
      type: "profile",
      url: `/${found.profile.username}`,
    },
    twitter: { card: "summary_large_image", title: name, description },
  };
}

export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { username } = await params;
  const clean = username.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(clean) || isReserved(clean)) notFound();

  const found = await getProfileByUsername(clean);
  if (!found) notFound();

  const { profile, stats } = found;
  const displayName = profile.display_name ?? `@${profile.username}`;
  const initial = (profile.display_name ?? profile.username)[0]?.toUpperCase() ?? "?";
  const xHandle = profile.x_handle;

  /*
   * The rest of the creator page: level chip (from confirmed aggregates) and
   * the feed of everything that reached this wallet. Everything hangs off the
   * wallet address, and a failed read drops its section rather than faking it.
   */
  const [level, feed, supporters, topBeggar] = await Promise.all([
    getLevelForWallet(profile.wallet_address),
    getActivityFeed(profile.wallet_address, 30),
    getSupporterList(profile.wallet_address, 20),
    isTopBeggar(profile.wallet_address),
  ]);

  return (
    <div className="safe-x mx-auto max-w-[1000px]">

      <main className="mx-auto grid max-w-[560px] gap-8 py-10">
        <header className="text-center">
          {profile.avatar_url ? (
            // A plain <img>, deliberately: the URL comes from user-supplied
            // storage, and next/image would proxy and re-serve it from our origin.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="mx-auto mb-3 size-[96px] rounded-full border-[1.5px] border-beg-line object-cover"
            />
          ) : (
            <div className="mx-auto mb-3 grid size-[96px] place-items-center rounded-full bg-beg-lime text-[40px] font-extrabold text-beg-ink">
              {initial}
            </div>
          )}

          <h1 className="text-[32px] font-extrabold tracking-[-.04em]">{displayName}</h1>
          <p className="text-beg-dim">@{profile.username}</p>

          {/*
            The address is shown, truncated, on the page itself — not only on a
            confirm screen. Spec §7.2 and §12: the main risk in this product is
            impersonation, and a username is not identity. Anyone about to send
            money should be able to see where it would actually go.
          */}
          <p className="mt-2 font-mono text-[13px] text-beg-dim" title={profile.wallet_address}>
            {shortAddress(profile.wallet_address)}
          </p>

          {level ? <LevelChip level={level.name} /> : null}

          {topBeggar ? (
            <span
              title={`Top 3 receiver the week of ${topBeggar.received ? "the previous week" : ""}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border-2 border-beg-ink bg-beg-yellow px-3 py-1 text-[11px] font-extrabold uppercase tracking-[.06em] text-beg-ink"
            >
              🏆 Top Beggar
            </span>
          ) : null}

          {profile.bio ? <p className="mx-auto mt-4 max-w-[46ch] text-beg-dim">{profile.bio}</p> : null}

          {/*
            Links out: X (with the verified tick when it is), Telegram, website.
            A visitor can check that this is a real person with a history, which
            matters more here than on most sites: they are about to send money
            to an address, and a name alone proves nothing.
          */}
          {xHandle || profile.telegram_handle || profile.website_url ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[13px]">
              {xHandle ? (
                <a
                  href={`https://x.com/${xHandle}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-beg-dim underline underline-offset-2 hover:text-beg-ink"
                >
                  @{xHandle} on X
                  {/* The tick: this handle completed BegFi's X verification. */}
                  {profile.x_verified_at ? (
                    <span
                      title="Verified — the owner posted a BegFi code from this handle"
                      aria-label="Verified X account"
                      className="ml-1 not-italic text-beg-ink"
                    >
                      ✔️
                    </span>
                  ) : null}
                </a>
              ) : null}
              {profile.telegram_handle ? (
                <a
                  href={`https://t.me/${profile.telegram_handle}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-beg-dim underline underline-offset-2 hover:text-beg-ink"
                >
                  Telegram
                </a>
              ) : null}
              {profile.website_url ? (
                <a
                  href={/^https?:\/\//i.test(profile.website_url) ? profile.website_url : `https://${profile.website_url}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-beg-dim underline underline-offset-2 hover:text-beg-ink"
                >
                  Website
                </a>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="card p-6">
          <div className="text-glow mb-1 text-center text-[40px] font-extrabold tracking-[-.04em] text-beg-ink">
            {formatAmount(BigInt(stats.total_received))}
          </div>
          <div className="mb-5 text-center text-[13px] text-beg-dim">
            $BEGFI received from {stats.supporters === 1 ? "1 supporter" : `${stats.supporters} supporters`}
          </div>

          {BEG_CONFIGURED ? (
            <SendPanel recipient={profile.wallet_address} username={profile.username} />
          ) : (
            <NotLaunchYet />
          )}
        </div>

        <QRShare username={profile.username} />

        {/*
          Supporters: the real sends this wallet has received, newest first,
          with each sender's note when one came attached. A hidden note stays
          hidden from this public page by the recipient's choice.
        */}
        {supporters.length > 0 ? (
          <section className="grid gap-3">
            <h2 className="text-xl font-extrabold tracking-[-.03em]">Supporters</h2>
            <ul className="grid gap-2">
              {supporters.map((s, i) => (
                <li
                  key={`${s.from_address}-${s.block_time}-${i}`}
                  className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]"
                >
                  <span className="font-mono text-beg-dim">{shortAddress(s.from_address)}</span>
                  {s.message ? <span className="min-w-0 flex-1 italic text-beg-ink">“{s.message}”</span> : <span className="min-w-0 flex-1" />}
                  <span className="whitespace-nowrap font-bold text-beg-ink">{formatAmount(s.amount)} $BEGFI</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/*
          Combined feed: everything that reached this wallet, newest first, straight
          from the confirmed rows. Trades belong to the token pages; here the
          story is what this person asked for and what they shipped.
        */}
        <section className="grid gap-3">
          <h2 className="text-xl font-extrabold tracking-[-.03em]">Activity</h2>
          {feed.dbFailed ? (
            <p className="notice-dashed p-5">Couldn&apos;t read the activity feed just now. Try again in a moment.</p>
          ) : feed.items.length === 0 ? (
            <p className="notice-dashed p-5">
              Nothing confirmed yet. Begs received show up here once they are
              on-chain.
            </p>
          ) : (
            <ul className="grid gap-2">
              {feed.items.map((item, i) => (
                <li key={`${item.kind}-${item.at}-${i}`} className="card-sm flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-beg-ink">{item.text}</span>
                  <span className="shrink-0 text-[11px] text-beg-dim">
                    {new Date(item.at).toLocaleDateString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="flex flex-wrap justify-between gap-2.5 border-t border-beg-line py-7 pb-12 text-beg-dim">
        <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
          beg<span className="text-beg-logo">fi</span>
          <RobinhoodFeather className="ml-[0.1em] text-beg-logo" />
        </span>
        <span className="text-sm">Anyone can claim a BegFi link. A username is not proof of identity.</span>
      </footer>
    </div>
  );
}

/**
 * Rendered instead of the send UI while `$BEGFI` has no address.
 *
 * This is the no-fake-data rule in its most important form: no send button, no
 * amount buttons, no disabled form implying that pressing things would work.
 * There is a sentence saying why, and nothing to click.
 */
function NotLaunchYet() {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-center">
      <p className="font-bold text-beg-ink">Sending isn&apos;t live yet</p>
      <p className="mt-1.5 text-[13px] text-beg-dim">
        $BEGFI hasn&apos;t been launched, so there is no token to send. This page becomes a payment page
        the moment it is.
      </p>
    </div>
  );
}
