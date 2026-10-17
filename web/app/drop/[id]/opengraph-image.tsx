import { ImageResponse } from "next/og";

import { getDropById } from "@/lib/drops";
import { formatAmount } from "@/lib/erc20";

export const alt = "A BegFi drop: a fixed prize, paid automatically";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * THE DROP SHARE CARD.
 *
 * A drop travels as a link pasted into a group chat, and a link with no image
 * is a link nobody opens. This card has to answer three questions at thumbnail
 * size: what is the prize, how many people can get it, and is it real. The
 * third one is the "paid automatically" line — the thing that separates this
 * from a screenshot of a promise.
 *
 * WHY IT DOES NOT SHOW A LIVE POT. An OG image is rendered by a crawler at an
 * arbitrary moment and cached; a "remaining" number here would be stale by the
 * time anyone clicks. The page carries the live figure; the card carries the
 * offer and the transaction guarantee.
 */
export default async function OG({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drop = await getDropById(id);

  if (!drop) {
    return new ImageResponse(
      (
        <div style={{ ...base, background: "#fffbe6", color: "#171208", justifyContent: "center", padding: 64 }}>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -4 }}>BegFi</div>
          <div style={{ fontSize: 38, color: "#6b6250", marginTop: 12 }}>This drop could not be found.</div>
        </div>
      ),
      size,
    );
  }

  const prize = `${formatAmount(drop.amountPerClaim, drop.tokenDecimals)} ${drop.tokenSymbol}`;
  const nameSize = drop.name.length > 26 ? 54 : 72;
  const isOpen = drop.status === "open";

  return new ImageResponse(
    (
      <div style={{ ...base, background: "#fffbe6", color: "#171208", padding: "52px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -2 }}>
              beg<span style={{ color: "#65a30d" }}>fi</span>
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 4,
                padding: "8px 16px",
                borderRadius: 999,
                border: "3px solid #171208",
                background: "#b8ff2f",
              }}
            >
              Drop
            </div>
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: 999,
              border: "3px solid #171208",
              background: isOpen ? "#ffffff" : "#ece6d4",
              color: isOpen ? "#171208" : "#6b6250",
            }}
          >
            {isOpen ? "open now" : drop.status}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
          <div
            style={{
              fontSize: nameSize,
              fontWeight: 800,
              letterSpacing: -3,
              lineHeight: 1.02,
              maxHeight: nameSize * 2.1,
              overflow: "hidden",
            }}
          >
            {drop.name}
          </div>
          <div style={{ fontSize: 30, color: "#6b6250", marginTop: 14, maxHeight: 42, overflow: "hidden" }}>
            {drop.description ?? `A fixed prize for the first ${drop.maxClaims} claimers.`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 30 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "22px 30px",
              borderRadius: 24,
              border: "4px solid #171208",
              background: "#b8ff2f",
            }}
          >
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2 }}>{prize}</div>
            <div style={{ fontSize: 21, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>
              per claim
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "22px 30px",
              borderRadius: 24,
              border: "4px solid #171208",
              background: "#ffffff",
            }}
          >
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -2 }}>{drop.maxClaims.toLocaleString("en-GB")}</div>
            <div style={{ fontSize: 21, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>max claimers</div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "22px 30px",
              borderRadius: 24,
              border: "4px solid #171208",
              background: "#ffffff",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>one per wallet</div>
            <div style={{ fontSize: 21, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginTop: 6 }}>
              and verified X
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 27, color: "#6b6250" }}>Paid automatically to the claimer&apos;s wallet.</div>
          <div style={{ fontSize: 27, fontWeight: 700 }}>begfi.io/drop/{drop.id.slice(0, 8)}…</div>
        </div>
      </div>
    ),
    size,
  );
}

const base: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, 'Segoe UI', sans-serif",
};
