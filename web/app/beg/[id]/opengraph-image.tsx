import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
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
 * words. Next generates it from the route convention, so nothing has to be
 * uploaded or stored — the image is a rendering of the row.
 *
 * Colours are the design tokens from globals.css, hardcoded because this is not
 * rendered into the document and Tailwind classes do not apply to it. If the
 * palette changes, this file is a second place to change — which is worth knowing
 * and is why the values are named here rather than sprinkled.
 */
const BG = "#07080A";
const CARD = "#111418";
const LINE = "#232830";
const INK = "#F4F7EE";
const DIM = "#8B93A0";
const LIME = "#CCFF00";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: string | null = null;
  let username: string | null = null;
  let displayName: string | null = null;

  if (SUPABASE_CONFIGURED && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const sb = await createClient();
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
      /* falls through to the not-found card below */
    }
  }

  // A beg that does not exist still gets an image, rather than a broken preview
  // in someone's feed. A 404 image shows as a grey box, which reads as a broken
  // link on the post itself.
  if (!body || !username) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
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

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: 72,
        }}
      >
        {/* The ask, sized to dominate. Long begs shrink rather than overflow. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            color: INK,
            fontSize: body.length > 120 ? 46 : body.length > 70 ? 56 : 68,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
          }}
        >
          {body}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 72,
                height: 72,
                borderRadius: 36,
                background: LIME,
                color: BG,
                fontSize: 34,
                fontWeight: 700,
              }}
            >
              {(displayName ?? "?")[0].toUpperCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: INK, fontSize: 32, fontWeight: 700 }}>{displayName}</div>
              <div style={{ color: DIM, fontSize: 26 }}>@{username}</div>
            </div>
          </div>

          {/* The brand, so a shared image says where it came from. */}
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>
            <span style={{ color: INK }}>beg</span>
            <span style={{ color: LIME }}>fi</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
