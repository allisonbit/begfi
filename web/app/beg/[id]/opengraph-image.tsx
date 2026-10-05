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
 * words — and, when the beg has a target, how far along it is. A progress bar in
 * the shared post is the whole reason to set a goal.
 *
 *** EVERY ELEMENT CARRIES AN EXPLICIT `display`. ***
 *
 * Satori, which renders this, refuses any element with more than one child unless
 * its display is stated outright — `flex`, `contents` or `none`. It does not
 * apply the browser's block default. The failure it produces is a 500 with NO
 * error in Vercel's logs (`logs: []`), so the page simply says "something went
 * wrong" and nothing anywhere says why.
 *
 * The rule applies to elements you would not think of as containers: a div
 * holding a single string, a div holding two spans, anything with a JSX comment
 * beside it. Every one of them gets a display here, via `F`. When adding to this
 * file, add one to yours too.
 *
 * NO SESSION, DELIBERATELY. This reads with the service role rather than the
 * caller's client, because a beg is public: whoever holds the link should see it,
 * including a crawler that has never visited the site. The session client would
 * call `cookies()`, which an image route has no request scope for.
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

/** Base units as a short readable string, without trailing zeros. */
function amount(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const rest = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  const text = rest ? `${whole}.${rest}` : whole.toString();
  return BigInt(text.replace(".", "")) > 999_999_999_999_999n ? `${whole.toLocaleString("en-GB")}` : text;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: string | null = null;
  let username: string | null = null;
  let displayName: string | null = null;
  let goal: bigint | null = null;
  let raised = 0n;
  let wallet: string | null = null;
  let createdAt: string | null = null;

  if (SUPABASE_CONFIGURED && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("begs")
        .select("body, goal, created_at, profiles!inner(username, display_name, wallet_address)")
        .eq("id", id)
        .maybeSingle<{
          body: string;
          goal: string | null;
          created_at: string;
          profiles: { username: string; display_name: string | null; wallet_address: string };
        }>();

      if (!error && data) {
        body = data.body;
        username = data.profiles.username;
        displayName = data.profiles.display_name ?? `@${data.profiles.username}`;
        wallet = data.profiles.wallet_address;
        createdAt = data.created_at;
        goal = data.goal ? BigInt(data.goal) : null;
      }
    } catch {
      /* the card below covers it */
    }
  }

  // Progress, only for a beg that set a target. A failure here leaves the card
  // without a bar rather than without an image.
  if (goal && wallet && createdAt) {
    try {
      const sb = createAdminClient();
      const { data: sum } = await sb.rpc("received_since", {
        p_wallet: wallet,
        p_since: createdAt,
      });
      if (sum !== null && sum !== undefined) raised = BigInt(sum as string);
    } catch {
      /* no bar */
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
  const askSize = body.length > 120 ? 46 : body.length > 70 ? 56 : 68;

  // Basis points, so the bar and the figure agree and no float touches a token
  // amount. Clamped, because over-filling is a success and a bar past its end
  // looks like a bug.
  const pct = goal && goal > 0n ? Math.min(100, Number((raised * 10_000n) / goal) / 100) : 0;

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

        {goal && goal > 0n ? (
          <div style={{ display: F, flexDirection: "column", marginBottom: 32 }}>
            <div style={{ display: F, justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <div style={{ display: F, color: LIME, fontSize: 40, fontWeight: 700 }}>
                {amount(raised)} $BEG
              </div>
              <div style={{ display: F, color: DIM, fontSize: 28 }}>
                of {amount(goal)} goal
              </div>
            </div>

            <div style={{ display: F, width: "100%", height: 18, borderRadius: 9, background: LINE, overflow: "hidden" }}>
              <div style={{ display: F, width: `${pct}%`, height: 18, borderRadius: 9, background: LIME }} />
            </div>
          </div>
        ) : null}

        <div style={{ display: F, alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 32 }}>
          <div style={{ display: F, alignItems: "center" }}>
            <div style={{ display: F, alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: 36, background: LIME, color: BG, fontSize: 34, fontWeight: 700, marginRight: 20 }}>
              {initial}
            </div>
            <div style={{ display: F, flexDirection: "column" }}>
              <div style={{ display: F, color: INK, fontSize: 32, fontWeight: 700 }}>{who}</div>
              <div style={{ display: F, color: DIM, fontSize: 26 }}>{`@${username}`}</div>
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
