import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";

import { publicUrl } from "@/lib/config";
import { getPayLink, isPayLinkId } from "@/lib/pay-links";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/qr/pay/<id> — the QR for one payment request.
 *
 * Same contract as the profile page's code (`/api/qr/[username]`): plain GET
 * returns a PNG, `?download=1` sets Content-Disposition so "Download QR" saves a
 * file, `?card=1` composes a share card through next/og with the code embedded
 * as a data URI so the card and the code cannot disagree about their target.
 *
 * RENDERED SERVER-SIDE, LIKE ITS SIBLING. The alternative — a browser QR library
 * — would put a second implementation of "what does this code point at" in the
 * client, and the first time the two drifted, the image and the link would send
 * people to different places. One renderer, one URL, from the row itself.
 *
 * ONLY LINKS THAT EXIST get a code. A QR pointing at a 404 is a promise with
 * nothing behind it; the profile route made the same call.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!SUPABASE_CONFIGURED || !isPayLinkId(id)) {
    return NextResponse.json({ error: "No such request." }, { status: 404 });
  }

  const link = await getPayLink(id);
  if (!link) {
    return NextResponse.json({ error: "No such request." }, { status: 404 });
  }

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const card = url.searchParams.get("card") === "1";

  const target = publicUrl(`/pay/${id}`);

  const png = await QRCode.toBuffer(target, {
    type: "png",
    width: card ? 520 : 900,
    margin: 2,
    color: { dark: "#161616", light: "#fff3d6" },
  });

  if (!card) {
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=300",
        ...(download ? { "content-disposition": `attachment; filename="begfi-pay-${id}.png"` } : {}),
      },
    });
  }

  // The share card: the ask as the headline, the code beside it. Every element
  // gets an explicit display — Satori refuses multi-child elements without one.
  const F = "flex" as const;
  const BG = "#07080A";
  const INK = "#F4F7EE";
  const DIM = "#8B93A0";
  const LIME = "#CCFF00";

  const ask = link.amount
    ? `${(BigInt(link.amount) / 10n ** 18n).toLocaleString("en-GB")} $BEGFI`
    : "Any amount";

  const image = new ImageResponse(
    (
      <div
        style={{
          display: F,
          width: "100%",
          height: "100%",
          background: BG,
          padding: 56,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 40,
        }}
      >
        <div style={{ display: F, flexDirection: "column", gap: 18, maxWidth: 640 }}>
          <div style={{ display: F, color: DIM, fontSize: 26 }}>Payment request</div>
          <div style={{ display: F, color: LIME, fontSize: 68, fontWeight: 800 }}>{ask}</div>
          <div style={{ display: F, color: INK, fontSize: 34, lineHeight: 1.25 }}>
            {link.memo && link.memo.length > 80 ? `${link.memo.slice(0, 79)}…` : (link.memo ?? "Pay me in $BEGFI")}
          </div>
          <div style={{ display: F, color: DIM, fontSize: 24 }}>
            {link.owner_username ? `@${link.owner_username}` : "begfi.io"}
          </div>
        </div>

        <div
          style={{
            display: F,
            background: "#fff3d6",
            padding: 14,
            borderRadius: 20,
            border: `4px solid ${LIME}`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${png.toString("base64")}`}
            alt=""
            width={340}
            height={340}
          />
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );

  return new NextResponse(image.body, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=300" },
  });
}
