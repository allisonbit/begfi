import { ImageResponse } from "next/og";

import { getReceipt, isTxHash } from "@/lib/receipts";
import { formatAmount } from "@/lib/erc20";

export const runtime = "nodejs";
export const alt = "A tip receipt on BegFi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share image for a tip receipt — the flex the receipt exists for.
 *
 * When the receipt link is posted, the crawler fetches this and gets the send
 * as a picture: the amount, who received it, the note when it sailed attached,
 * and the link back. Every figure is the indexer's confirmed transfer; an
 * unreadable tx gets an honest "nothing to see" card.
 *
*** EVERY ELEMENT CARRIES AN EXPLICIT `display`. *** (Satori fails 500-only
 * on the omitted ones — see the beg card's note; `F` is mandatory here too.)
 */
const BG = "#07080A";
const LINE = "#232830";
const INK = "#F4F7EE";
const DIM = "#8B93A0";
const LIME = "#CCFF00";

const F = "flex" as const;

export default async function Image({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  const receipt = isTxHash(tx) ? await getReceipt(tx) : null;

  if (!receipt) {
    return new ImageResponse(
      (
        <div style={{ display: F, width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: BG, color: DIM, fontSize: 40 }}>
          No confirmed $BEGFI transfer for this transaction.
        </div>
      ),
      size,
    );
  }

  const toName = receipt.to_username
    ? receipt.to_display_name ?? `@${receipt.to_username}`
    : `${receipt.to_wallet.slice(0, 6)}…${receipt.to_wallet.slice(-4)}`;
  const toHandle = receipt.to_username ? `@${receipt.to_username}` : receipt.to_wallet;
  const fromName = receipt.from_username ? `@${receipt.from_username}` : `${receipt.from_wallet.slice(0, 6)}…${receipt.from_wallet.slice(-4)}`;
  const amount = formatAmount(BigInt(receipt.amount));
  const initial = (receipt.to_display_name ?? toHandle).replace("@", "")[0]?.toUpperCase() ?? "?";

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
        <div style={{ display: F, flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ display: F, color: DIM, fontSize: 30, marginBottom: 18 }}>A confirmed tip</div>
          <div style={{ display: F, color: LIME, fontSize: 96, fontWeight: 800, letterSpacing: "-0.04em" }}>
            {amount} $BEGFI
          </div>
          {receipt.message && !receipt.message_hidden ? (
            <div style={{ display: F, color: INK, fontSize: 40, fontWeight: 700, marginTop: 28, maxWidth: 950 }}>
              {`“${receipt.message.trim().slice(0, 90)}${receipt.message.trim().length > 90 ? "…" : ""}”`}
            </div>
          ) : receipt.message_hidden ? (
            <div style={{ display: F, color: DIM, fontSize: 30, marginTop: 28 }}>Message kept private.</div>
          ) : null}
        </div>

        <div style={{ display: F, alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 36 }}>
          <div style={{ display: F, alignItems: "center" }}>
            <div style={{ display: F, alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 42, background: LIME, color: BG, fontSize: 38, fontWeight: 800, marginRight: 22 }}>
              {initial}
            </div>
            <div style={{ display: F, flexDirection: "column" }}>
              <div style={{ display: F, color: INK, fontSize: 34, fontWeight: 700 }}>{toName}</div>
              <div style={{ display: F, color: DIM, fontSize: 26 }}>{`from ${fromName} · ${toHandle}`}</div>
            </div>
          </div>

          <div style={{ display: F, flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: F, fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em" }}>
              <span style={{ display: F, color: INK }}>beg</span>
              <span style={{ display: F, color: LIME }}>fi</span>
            </div>
            <div style={{ display: F, color: DIM, fontSize: 24, marginTop: 6 }}>
              {receipt.to_username ? `pay back at begfi.io/@${receipt.to_username}` : "receipt verified on-chain"}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
