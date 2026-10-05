import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

export const runtime = "nodejs";
export const alt = "A beg on BegFi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share image for a beg.
 *
 * This is what makes a beg a beg rather than a bare link: when the URL is posted
 * to X, Telegram or WhatsApp, the crawler fetches this and gets a picture of the
 * words. Next generates it from the route convention, so nothing is uploaded or
 * stored — the image is a rendering of the row.
 *
 *** EVERY ELEMENT CARRIES AN EXPLICIT `display`. ***
 *
 * Satori, which renders this, refuses any element with more than one child unless
 * its display is stated outright — `display: flex`, `contents` or `none`. It does
 * not apply the browser's block default. The failure it produces is a 500 with NO
 * error in Vercel's logs (`logs: []`), so the page simply says "something went
 * wrong" and nothing anywhere says why.
 *
 * The rule that cost real time here is that it applies to elements you would not
 * think of as containers: a div holding a single string, a div holding two spans,
 * anything with a JSX comment beside it. Every one of them gets a display here.
 * When adding to this file, add one to yours too.
 *
 * NO SESSION, DELIBERATELY. This reads with the service role rather than the
 * caller's client, because a beg is public: whoever holds the link is meant to
 * see it, including a crawler that has never visited the site. The session client
 * would call `cookies()`, which an image route has no request scope for.
 *
 * Colours are the design tokens from globals.css, hardcoded because this is not
 * rendered into the document and Tailwind classes do not apply to it.
 */
const BG = "#07080A";
const LINE = "#232830";
const INK = "#F4F7EE";
const DIM = "#8B93A0";
const LIME = "#CCFF00";

/** A ready-made display value, so no element in this file can forget one. */
const F = "flex" as const;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: string | null = null;
  let username: string | null = null;
  let displayName: string | null = null;

  if (SUPABASE_CONFIGURED && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("begs")
        .select("body, profiles!inner(username, display_name)")
        .eq("id", id)
        .maybeSingle<{
          body: string;
          profiles: { username: string; display_name: string | null };
        }>();

      if (!error && data) {
        body = data.body;
        username = data.profiles.username;
        displayName = data.profiles.display_name ?? `@${data.profiles.username}`;
      }
    } catch {
      /* the card below covers it */
    }
  }

  // A beg that does not exist still gets an image rather than a broken preview.
  if (!body || !username) {
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
            fontSize: 40,
          }}
        >
          This beg is no longer available.
        </div>
      ),
      size,
    );
  }

  const initial = (displayName ?? "?")[0].toUpperCase();
  const who = displayName ?? "";
  const handle = `@${username}`;
  const askSize = body.length > 120 ? 46 : body.length > 70 ? 56 : 68;

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
        }}
      >
        <div style={{ display: F, alignItems: "center", flex: 1, color: INK, fontSize: askSize, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.03em" }}>
          {body}
        </div>

        <div style={{ display: F, alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 32 }}>
          <div style={{ display: F, alignItems: "center" }}>
            <div style={{ display: F, alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: 36, background: LIME, color: BG, fontSize: 34, fontWeight: 700, marginRight: 20 }}>
              {initial}
            </div>
            <div style={{ display: F, flexDirection: "column" }}>
              <div style={{ display: F, color: INK, fontSize: 32, fontWeight: 700 }}>{who}</div>
              <div style={{ display: F, color: DIM, fontSize: 26 }}>{handle}</div>
            </div>
          </div>

          <div style={{ display: F, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>
            <span style={{ display: F, color: INK }}>beg</span>
            <span style={{ display: F, color: LIME }}>fi</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
