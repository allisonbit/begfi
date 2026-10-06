import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SendPanel } from "@/components/send-panel";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, USERNAME_PATTERN, isReserved } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getProfileByUsername } from "@/lib/queries";

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
  const description = found.profile.bio ?? `Send ${name} some $BEG on Robinhood Chain.`;

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
            <div className="mx-auto mb-3 grid size-[96px] place-items-center rounded-full bg-beg-lime text-[40px] font-extrabold text-beg-bg">
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

          {profile.bio ? <p className="mx-auto mt-4 max-w-[46ch] text-beg-dim">{profile.bio}</p> : null}

          {/*
            The X handle, as a link out. It is the one place a visitor can check
            that this is a real person with a history, which matters more here than
            on most sites: they are about to send money to an address, and a name
            alone proves nothing.
          */}
          {xHandle ? (
            <a
              href={`https://x.com/${xHandle}`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-block text-[13px] text-beg-dim underline underline-offset-2 hover:text-beg-ink"
            >
              @{xHandle} on X
            </a>
          ) : null}
        </header>

        <div className="card p-6">
          <div className="text-glow mb-1 text-center text-[40px] font-extrabold tracking-[-.04em] text-beg-lime">
            {formatAmount(BigInt(stats.total_received))}
          </div>
          <div className="mb-5 text-center text-[13px] text-beg-dim">
            $BEG received · {stats.supporters === 1 ? "1 supporter" : `${stats.supporters} supporters`}
          </div>

          {BEG_CONFIGURED ? (
            <SendPanel recipient={profile.wallet_address} username={profile.username} />
          ) : (
            <NotLaunchYet />
          )}
        </div>
      </main>

      <footer className="flex flex-wrap justify-between gap-2.5 border-t border-beg-line py-7 pb-12 text-beg-dim">
        <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
          beg<span className="text-beg-lime">fi</span>
        </span>
        <span className="text-sm">Anyone can claim a BegFi link. A username is not proof of identity.</span>
      </footer>
    </div>
  );
}

/**
 * Rendered instead of the send UI while `$BEG` has no address.
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
        $BEG hasn&apos;t been launched, so there is no token to send. This page becomes a payment page
        the moment it is.
      </p>
    </div>
  );
}
