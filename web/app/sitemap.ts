import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * /sitemap.xml — every public page, for the crawlers that do not exist yet on
 * our side of the story.
 *
 * WHY THIS FILE MATTERS MORE HERE THAN ON MOST SITES. BegFi's entire growth
 * model is a link someone shares. Until this existed, the only pages Google
 * could discover were the ones a human happened to link to, which means the
 * thousands of `/username`, `/beg/<id>` and `/earn/<slug>` pages — the actual
 * product — were invisible. A sitemap is the cheapest possible distribution
 * work: it costs one HTTP call per crawl instead of one feature.
 *
 * WHY IT IS GENERATED PER REQUEST. The reads below run with the caller's
 * session, through the same anon client every public page uses, so RLS decides
 * visibility — specifically the `is_hidden` policy on `profiles`. A hidden
 * profile cannot appear here even if a filter is forgotten, because the policy
 * is the guard rather than this file. That means reading cookies, which makes
 * the route dynamic; the CDN caches the response, and four bounded queries are
 * cheap.
 *
 * WHY A FAILED READ IS SWALLOWED, WHICH IS NORMALLY WRONG. Everywhere else in
 * this codebase a swallowed error is a bug: a failed read that renders as "none
 * exist" is a lie about the product. Here the failure mode is different. A
 * sitemap that 500s tells a crawler the whole site is broken, and a missing URL
 * costs a delayed crawl of one page — it never states anything untrue. So each
 * source degrades independently to no URLs from that source, and the static
 * routes always ship. This is the one place where a partial answer beats no
 * answer.
 */

/**
 * Routes with no row behind them. Listed rather than derived, because a route
 * is a thing a person wrote, not a thing the database knows about: if one is
 * deleted, this line fails to compile against nothing and has to be removed by
 * hand, which is exactly the review that should happen.
 */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/begs", priority: 0.9, changeFrequency: "hourly" },
  { path: "/earn", priority: 0.9, changeFrequency: "hourly" },
  { path: "/leaderboard", priority: 0.8, changeFrequency: "daily" },
  // The books. Listed for the same reason a shop lists its licence: the crawler
  // that finds it is usually a person deciding whether to trust the site with a pool.
  { path: "/transparency", priority: 0.7, changeFrequency: "daily" },
  { path: "/terms", priority: 0.2, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "monthly" },
];

/**
 * Caps, deliberately low. A sitemap is a hint, not a database dump: the
 * protocol allows 50,000 URLs, but a crawler gives a bounded amount of budget
 * to a small site, and 50,000 thin pages would spend it on the wrong ones. The
 * newest pages are listed — which are the ones worth indexing — and older ones
 * are reachable from the pages that are listed.
 */
const MAX_PROFILES = 5_000;
const MAX_BEGS = 2_000;
const MAX_CAMPAIGNS = 500;
const MAX_PAY_LINKS = 1_000;

/**
 * Tip receipts (`/t/<tx>`) are deliberately absent.
 *
 * They are legitimate public pages and they unfurl well, which is the point of
 * them — but they are unbounded user-generated content, one per transfer, and
 * they are shared directly rather than searched for. Listing them would spend
 * the crawl budget this file exists to protect, on pages no one arrives at from
 * a search result.
 */

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: publicUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  if (!SUPABASE_CONFIGURED) return entries;

  let sb: Awaited<ReturnType<typeof createClient>>;
  try {
    sb = await createClient();
  } catch {
    return entries;
  }

  // ---- profiles ------------------------------------------------------------
  // `is_hidden = false` is written out even though the RLS policy already
  // enforces it: the explicit filter keeps the intent readable at the call
  // site, and the policy is what keeps it true if this line is ever edited.
  const visible = new Map<string, string>(); // profile id -> username
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, username, updated_at")
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(MAX_PROFILES);

    if (!error && data) {
      for (const row of data as { id: string; username: string; updated_at: string | null }[]) {
        visible.set(row.id, row.username);
        entries.push({
          url: publicUrl(`/${row.username}`),
          lastModified: row.updated_at ? new Date(row.updated_at) : now,
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
    }
  } catch {
    // No profiles this run. The static routes and any later source still ship.
  }

  // ---- begs ----------------------------------------------------------------
  // Filtered through the visible set rather than trusted to the `begs` policy,
  // which is `using (true)` by design (a beg must be readable by whoever the
  // link was sent to). A beg whose owner has hidden their profile would
  // otherwise be listed as a page that 404s on the way to its own pay link.
  try {
    const { data, error } = await sb
      .from("begs")
      .select("id, profile_id, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_BEGS);

    if (!error && data) {
      for (const row of data as { id: string; profile_id: string; created_at: string }[]) {
        if (!visible.has(row.profile_id)) continue;
        entries.push({
          url: publicUrl(`/beg/${row.id}`),
          lastModified: new Date(row.created_at),
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }
  } catch {
    // Same rule as above.
  }

  // ---- campaigns -----------------------------------------------------------
  // Drafts are excluded: a draft is unpublished by definition, and its page
  // says so. `ended` stays in the list because a finished campaign is a real
  // page with a real history, and it is where a reader decides whether to trust
  // the next one.
  try {
    const { data, error } = await sb
      .from("campaigns")
      .select("slug, updated_at, status")
      .in("status", ["active", "ended"])
      .order("created_at", { ascending: false })
      .limit(MAX_CAMPAIGNS);

    if (!error && data) {
      for (const row of data as { slug: string; updated_at: string | null; status: string }[]) {
        entries.push({
          url: publicUrl(`/earn/${row.slug}`),
          lastModified: row.updated_at ? new Date(row.updated_at) : now,
          changeFrequency: row.status === "active" ? "daily" : "weekly",
          priority: row.status === "active" ? 0.8 : 0.4,
        });
      }
    }
  } catch {
    // Same rule as above.
  }

  // ---- pay links -----------------------------------------------------------
  // Only the open ones. A closed request stays reachable (its page still works
  // and says it is closed), but it is not something to index: it asks for
  // nothing any more, and a crawler's budget is better spent on links that do.
  try {
    const { data, error } = await sb
      .from("pay_links")
      .select("id, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(MAX_PAY_LINKS);

    if (!error && data) {
      for (const row of data as { id: string; created_at: string }[]) {
        entries.push({
          url: publicUrl(`/pay/${row.id}`),
          lastModified: new Date(row.created_at),
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
    }
  } catch {
    // Same rule as above.
  }

  return entries;
}
