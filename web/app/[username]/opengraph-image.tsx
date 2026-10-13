import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { LINK_ORIGIN } from "@/lib/config";
import { MASCOT_BASE64 } from "@/lib/og/mascot";

export const runtime = "nodejs";
export const alt = "A BegFi link";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share card for a BegFi link — what a crawler fetches when
 * begfi.io/username is posted to X, Telegram or WhatsApp. This card IS "the
 * link": before a visitor clicks, this picture is the whole product.
 *
 * Same rules as the beg card (app/beg/[id]/opengraph-image.tsx): every element
 * carries an explicit `display` because Satori refuses multi-child elements
 * without one, colours are hardcoded design tokens because Tailwind classes do
 * not reach this render, and the mascot arrives as a base64 data URL because
 * Satori does no network fetches.
 *
 * NO SESSION, DELIBERATELY. This reads with the service role, like the beg
 * card, because a crawler has never visited the site and has no cookies; the
 * session client would call `cookies()` in a route with no request scope.
 * What it reads is public by RLS: username, display name, bio, supporters
 * count.
 *
 * THE WALLET ADDRESS IS NOT PRINTED. The page shows it truncated so a sender
 * can see where money goes before confirming, but this card travels to places
 * the visitor never chose to visit — a sticker on someone else's post — and a
 * screenshot-able address is harvesting bait. The card shows the URL instead,
 * which is what the link is.
 *
 * Colours are the Sticker Pop tokens from globals.css, hardcoded.
 */
const BG = "#FFF3D6"; /* the sticker sheet */
const CARD = "#FFFCF2"; /* card stock */
const INK = "#161616"; /* borders and text */
const DIM = "#59626F"; /* secondary text */
const LIME = "#CCFF00"; /* Robin Neon */
const GREEN = "#00A651"; /* Robinhood logo green */

const F = "flex" as const;

type Params = { username: string };

export default async function Image({ params }: { params: Promise<Params> }) {
  const { username: raw } = await params;
  const username = raw.trim().toLowerCase();

  let displayName: string | null = null;
  let bio: string | null = null;
  let supporters: number | null = null;

  if (SUPABASE_CONFIGURED && /^[a-z0-9_]{3,20}$/.test(username)) {
    try {
      const sb = createAdminClient();

      /*
       * Two reads, not one embedded join. `begfi.profile_stats` is a VIEW
       * keyed by profile_id with no declared foreign key, so PostgREST cannot
       * relate it to `profiles` — an embedded `profile_stats(supporters)`
       * select fails with PGRST200 and (before this fix) silently degraded
       * every claimed profile to the fallback card. The parallel shape the
       * page itself uses (getProfileByUsername) reads them the same way.
       */
      const { data: profile, error: profileError } = await sb
        .from("profiles")
        .select("id, username, display_name, bio")
        .eq("username", username)
        .maybeSingle<{ id: string; username: string; display_name: string | null; bio: string | null }>();

      if (!profileError && profile) {
        displayName = profile.display_name ?? `@${profile.username}`;
        bio = profile.bio;

        const { data: stats } = await sb
          .from("profile_stats")
          .select("profile_id, supporters")
          .eq("profile_id", profile.id)
          .maybeSingle<{ profile_id: string; supporters: number }>();
        supporters = stats?.supporters ?? 0;
      }
    } catch {
      /* the generic card below covers it */
    }
  }

  // A username that does not resolve still gets an image rather than a broken
  // preview — the same honesty rule as the beg card's "no longer available".
  if (!displayName) {
    return new ImageResponse(
      (
        <div
          style={{
            display: F,
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            background: BG,
            color: DIM,
            fontSize: 44,
          }}
        >
          This BegFi link isn&apos;t claimed yet.
        </div>
      ),
      size,
    );
  }

  const url = `${LINK_ORIGIN.replace(/^https?:\/\//, "")}/${username}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: F,
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: BG,
          padding: 72,
          color: INK,
        }}
      >
        {/* the person: mascot badge + who this link belongs to */}
        <div style={{ display: F, alignItems: "center", gap: 36 }}>
          <img
            src={MASCOT_BASE64}
            width={200}
            height={200}
            style={{ borderRadius: 100, border: `6px solid ${INK}` }}
          />
          <div style={{ display: F, flexDirection: "column" }}>
            <div style={{ display: F, fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em" }}>
              {displayName}
            </div>
            <div style={{ display: F, fontSize: 36, color: GREEN, fontWeight: 700 }}>
              {url}
            </div>
          </div>
        </div>

        {bio ? (
          <div style={{ display: F, fontSize: 40, color: DIM, lineHeight: 1.3, paddingRight: 40 }}>
            {bio.length > 110 ? `${bio.slice(0, 107)}…` : bio}
          </div>
        ) : null}

        {/* the action bar: what a visitor does after clicking */}
        <div style={{ display: F, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div
            style={{
              display: F,
              padding: "20px 34px",
              background: LIME,
              border: `4px solid ${INK}`,
              borderRadius: 999,
              boxShadow: "8px 8px 0 0 " + INK,
              fontSize: 38,
              fontWeight: 700,
            }}
          >
            Send $BEG — straight to their wallet
          </div>
          <div style={{ display: F, fontSize: 30, color: DIM, fontWeight: 600 }}>
            {supporters === null
              ? "on Robinhood Chain"
              : supporters === 1
                ? "1 supporter · Robinhood Chain"
                : `${supporters} supporters · Robinhood Chain`}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
