import type { Metadata } from "next";
import Link from "next/link";

import { shortAddress } from "@/lib/chains";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

export const metadata: Metadata = {
  title: "Search",
  description: "Find a person, a campaign or a drop on BegFi.",
};

export const dynamic = "force-dynamic";

/**
 * /search — one field, three public things.
 *
 * WHY IT IS SERVER-RENDERED AND HAS NO CLIENT STATE. The whole result set is
 * public data behind RLS, the query is a GET, and a search box that needs
 * JavaScript to work is a search box that fails for the crawler and the old
 * phone. The form submits, the server answers, the URL is shareable.
 *
 * WHY THERE IS NO `.or()` FILTER. Supabase's `.or()` takes a mini-language where
 * a comma or parenthesis in the query is syntax; a person searching for a name
 * with a comma would get a 400 instead of results. Each column is queried
 * separately and merged by id, which costs one more round trip and removes the
 * whole class of parser surprises.
 *
 * WHAT IS NOT SEARCHABLE: begs, pay links and receipts. A beg is a short public
 * post with no title, a pay link is shared privately, and a receipt is a
 * pointer to a transaction — indexing any of them would turn a search box into
 * a place to find people by what they asked for. Usernames, campaigns and drops
 * are things people publish on purpose.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const ready = query.length >= 2;

  let people: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    wallet_address: string;
  }[] = [];
  let campaigns: { slug: string; name: string; token_symbol: string; status: string }[] = [];
  let drops: { id: string; name: string; token_symbol: string; status: string }[] = [];
  let failed = false;

  if (ready && SUPABASE_CONFIGURED) {
    const sb = await createClient();
    const like = `%${query}%`;

    const [byUsername, byName, campaignByName, campaignBySlug, dropByName] = await Promise.all([
      sb
        .from("profiles")
        .select("id, username, display_name, avatar_url, wallet_address")
        .ilike("username", like)
        .limit(10),
      sb
        .from("profiles")
        .select("id, username, display_name, avatar_url, wallet_address")
        .ilike("display_name", like)
        .limit(10),
      sb
        .from("campaigns")
        .select("slug, name, token_symbol, status")
        .ilike("name", like)
        .neq("status", "draft")
        .limit(10),
      sb
        .from("campaigns")
        .select("slug, name, token_symbol, status")
        .ilike("slug", like)
        .neq("status", "draft")
        .limit(10),
      sb.from("drops").select("id, name, token_symbol, status").ilike("name", like).limit(10),
    ]);

    failed = Boolean(byUsername.error || byName.error || campaignByName.error || campaignBySlug.error || dropByName.error);

    const peopleById = new Map<string, (typeof people)[number]>();
    for (const row of [...(byUsername.data ?? []), ...(byName.data ?? [])] as typeof people) {
      peopleById.set(row.id, row);
    }
    people = [...peopleById.values()];

    const campaignsBySlug = new Map<string, (typeof campaigns)[number]>();
    for (const row of [...(campaignByName.data ?? []), ...(campaignBySlug.data ?? [])] as typeof campaigns) {
      campaignsBySlug.set(row.slug, row);
    }
    campaigns = [...campaignsBySlug.values()];
    drops = (dropByName.data ?? []) as typeof drops;
  }

  const nothing = ready && !failed && people.length === 0 && campaigns.length === 0 && drops.length === 0;

  return (
    <div className="safe-x mx-auto max-w-[760px] py-10">
      <header>
        <h1 className="text-[clamp(32px,7vw,56px)] font-extrabold leading-[1] tracking-[-.04em]">Search.</h1>
        <p className="mt-2 text-beg-dim">A username, a campaign, a drop. Public pages only.</p>
      </header>

      <form action="/search" method="get" role="search" className="mt-6 flex gap-2">
        <label className="sr-only" htmlFor="q">
          Search BegFi
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="@name, campaign, drop…"
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 rounded-2xl border-[2px] border-beg-ink bg-beg-card px-4 py-3 text-[16px] text-beg-ink outline-none placeholder:text-beg-dim focus:border-beg-lime"
        />
        <button type="submit" className="btn-primary px-5 py-3">
          Search
        </button>
      </form>

      {!ready ? (
        <div className="mt-6 card p-5">
          <p className="text-[14px] font-bold text-beg-ink">Two characters is the minimum.</p>
          <p className="mt-1 text-[13px] text-beg-dim">
            Try a username, a project name, or the name of a giveaway. You can also{" "}
            <Link href="/begs" className="underline underline-offset-2 hover:text-beg-ink">
              browse the newest begs
            </Link>{" "}
            or{" "}
            <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
              the live campaigns
            </Link>
            .
          </p>
        </div>
      ) : failed ? (
        <p className="notice-dashed mt-6">Search couldn&apos;t read the database just now. Try again in a moment.</p>
      ) : nothing ? (
        <p className="notice-dashed mt-6">
          Nothing matched “{query}”. Names are exact-ish — try fewer letters — and only public profiles, campaigns and
          drops are searchable.
        </p>
      ) : (
        <div className="mt-8 grid gap-8">
          {people.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[13px] font-extrabold uppercase tracking-[.1em] text-beg-dim">People</h2>
              <ul className="grid gap-2">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${p.username}`} className="card-sm flex items-center gap-3 with-hover">
                      {p.avatar_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={p.avatar_url} alt="" className="size-9 rounded-full border-2 border-beg-ink object-cover" />
                      ) : (
                        <span className="grid size-9 place-items-center rounded-full border-2 border-beg-ink bg-beg-lime text-[13px] font-extrabold">
                          {p.username[0]?.toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-beg-ink">@{p.username}</span>
                        <span className="block truncate text-[12px] text-beg-dim">
                          {p.display_name ?? shortAddress(p.wallet_address)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {campaigns.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[13px] font-extrabold uppercase tracking-[.1em] text-beg-dim">Campaigns</h2>
              <ul className="grid gap-2">
                {campaigns.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/earn/${c.slug}`} className="card-sm flex items-center justify-between gap-3 with-hover">
                      <span className="min-w-0 truncate font-bold text-beg-ink">{c.name}</span>
                      <span className="shrink-0 text-[12px] text-beg-dim">
                        {c.token_symbol} · {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {drops.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[13px] font-extrabold uppercase tracking-[.1em] text-beg-dim">Drops</h2>
              <ul className="grid gap-2">
                {drops.map((d) => (
                  <li key={d.id}>
                    <Link href={`/drop/${d.id}`} className="card-sm flex items-center justify-between gap-3 with-hover">
                      <span className="min-w-0 truncate font-bold text-beg-ink">{d.name}</span>
                      <span className="shrink-0 text-[12px] text-beg-dim">
                        {d.token_symbol} · {d.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
