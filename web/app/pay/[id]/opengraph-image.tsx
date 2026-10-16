import { ImageResponse } from "next/og";

import { isPayLinkId } from "@/lib/pay-links";
import { getPayLink } from "@/lib/pay-links";
import { shortAddress } from "@/lib/chains";

export const runtime = "nodejs";
export const alt = "A payment request on BegFi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share image for a pay link.
 *
 * THE CARD IS THE PRODUCT HERE. A request is only as good as the thing it looks
 * like when it lands in a group chat: "Pay me 20 $BEGFI — Lunch" as a picture is
 * a request; a bare URL is a link people scroll past. This is the same reasoning
 * as the beg card, applied to money we are asking for rather than money we are
 * asking for generally.
 *
 * EVERY ELEMENT CARRIES AN EXPLICIT `display`. Satori refuses any element with
 * more than one child unless its display is stated outright, and the failure is
 * a 500 with nothing in the logs. See the beg card for the long version of this
 * warning; `F` below is the shorthand that makes it impossible to forget.
 *
 * NO SESSION: a pay link is public, and an image route has no request scope for
 * `cookies()`. Reads with the service role, exactly like every other share card.
 *
 * Colours are the design tokens, hardcoded because Tailwind does not apply here.
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
  return rest ? `${whole.toLocaleString("en-GB")}.${rest}` : whole.toLocaleString("en-GB");
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const link = isPayLinkId(id) ? await getPayLink(id) : null;

  const who = link
    ? link.owner_username
      ? `@${link.owner_username}`
      : shortAddress(link.owner_wallet)
    : "BegFi";

  const ask = link?.amount ? `${amount(BigInt(link.amount))} $BEGFI` : "Any amount";
  const memo = link?.memo ?? "Pay me in $BEGFI";
  const closed = link ? !link.is_active : false;

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
          padding: 64,
        }}
      >
        <div style={{ display: F, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: F, alignItems: "center", gap: 14 }}>
            <div style={{ display: F, color: INK, fontSize: 44, fontWeight: 800 }}>begfi</div>
            <div
              style={{ display: F, width: 14, height: 14, background: LIME, borderRadius: 999 }}
            />
          </div>
          <div style={{ display: F, color: DIM, fontSize: 26 }}>
            {closed ? "This request is closed" : "Payment request"}
          </div>
        </div>

        <div style={{ display: F, flexDirection: "column", gap: 18 }}>
          <div style={{ display: F, color: LIME, fontSize: 92, fontWeight: 800, lineHeight: 1 }}>
            {ask}
          </div>
          <div style={{ display: F, color: INK, fontSize: 40, lineHeight: 1.25 }}>
            {memo.length > 90 ? `${memo.slice(0, 89)}…` : memo}
          </div>
            <div style={{ display: F, color: DIM, fontSize: 28 }}>to {who}</div>
        </div>

        <div
          style={{
            display: F,
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 24,
          }}
        >
          <div style={{ display: F, color: DIM, fontSize: 24 }}>
            Wallet to wallet on Robinhood Chain — BegFi never holds the money
          </div>
          <div style={{ display: F, color: INK, fontSize: 24 }}>begfi.io/pay</div>
        </div>
      </div>
    ),
    size,
  );
}
