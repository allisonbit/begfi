import { ImageResponse } from "next/og";
import { MASCOT_BASE64 } from "@/lib/og/mascot";

export const runtime = "nodejs";
export const alt = "BegFi — your road to freewill";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The site's own share card: what crawlers fetch when begfi.io itself is
 * posted to X, Telegram or WhatsApp.
 *
 * Same rules as the beg card (app/beg/[id]/opengraph-image.tsx): every element
 * carries an explicit `display` because Satori refuses multi-child elements
 * without one, colours are hardcoded design tokens because Tailwind classes do
 * not reach this render, and the mascot arrives as a base64 data URL because
 * Satori does no network fetches.
 *
 * Colours are the Sticker Pop tokens from globals.css, on the cream sheet the
 * site pages use — the beg card is dark, the brand face is the sheet itself.
 */
const BG = "#FFF3D6"; /* the sticker sheet */
const CARD = "#FFFCF2"; /* card stock */
const INK = "#161616"; /* borders and text */
const LIME = "#CCFF00"; /* Robin Neon */
const GREEN = "#00A651"; /* Robinhood logo green */
const FEET_HEX_BOLD = 700;

const F = "flex" as const;

export default function Image() {
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
        {/* top row: the mascot and the name it belongs to */}
        <div style={{ display: F, alignItems: "center", gap: 40 }}>
          <img
            src={MASCOT_BASE64}
            width={220}
            height={220}
            style={{ borderRadius: 48, border: `6px solid ${INK}` }}
          />
          <div style={{ display: F, flexDirection: "column" }}>
            <div
              style={{
                display: F,
                fontSize: 96,
                fontWeight: FEET_HEX_BOLD,
                letterSpacing: "-0.05em",
              }}
            >
              <span style={{ display: F }}>beg</span>
              <span style={{ display: F, color: GREEN }}>fi</span>
            </div>
            <div style={{ display: F, fontSize: 40, color: "#59626F" }}>
              Your road to freewill.
            </div>
          </div>
        </div>

        {/* bottom row: the three things the product does, on card-stock chips */}
        <div style={{ display: F, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: F, gap: 16 }}>
            {["/yourname pays", "/launch a token", "/begs that compound"].map((chip) => (
              <div
                key={chip}
                style={{
                  display: F,
                  padding: "18px 30px",
                  background: CARD,
                  border: `4px solid ${INK}`,
                  borderRadius: 999,
                  boxShadow: "8px 8px 0 0 " + INK,
                  fontSize: 34,
                  fontWeight: 600,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div
            style={{
              display: F,
              padding: "18px 30px",
              background: LIME,
              border: `4px solid ${INK}`,
              borderRadius: 999,
              boxShadow: "8px 8px 0 0 " + INK,
              fontSize: 34,
              fontWeight: FEET_HEX_BOLD,
            }}
          >
            begfi.io
          </div>
        </div>
      </div>
    ),
    size,
  );
}
