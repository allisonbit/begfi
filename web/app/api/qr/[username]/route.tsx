import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";

import { linkFor } from "@/lib/config";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/qr/[username] — the QR for a payment page, and its share card.
 *
 * Plain `GET` returns a square PNG QR of begfi.io/username. `?download=1`
 * sets Content-Disposition so a "Download QR" button saves a file. `?card=1`
 * composes the share card through next/og (same engine as every share image
 * on this site): username, the ask, and the QR itself embedded as a data
 * URI, so the card and the code can never disagree about the target.
 *
 * Both variants are only generated for usernames that exist and are public:
 * a QR or a promo card pointing at a page that 404s would be a promise with
 * nothing behind it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const clean = username.toLowerCase();

  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    return NextResponse.json({ error: "No such profile." }, { status: 404 });
  }

  if (SUPABASE_CONFIGURED) {
    try {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("username", clean)
        .eq("is_hidden", false)
        .maybeSingle<{ id: string }>();
      if (!profile) return NextResponse.json({ error: "No such profile." }, { status: 404 });
    } catch {
      // A database problem must not 404 an existing person; refuse loudly
      // rather than render a code that might point at nothing.
      return NextResponse.json({ error: "Could not verify the profile." }, { status: 503 });
    }
  }

  const target = linkFor(clean);
  const png = await QRCode.toBuffer(target, {
    type: "png",
    width: 720,
    margin: 2,
    color: { dark: "#161616", light: "#FFF3D6" },
    errorCorrectionLevel: "M",
  });

  const url = new URL(request.url);
  const wantsCard = url.searchParams.get("card");
  const wantsDownload = url.searchParams.get("download");

  if (wantsCard) {
    const dataUri = png.toString("base64");
    const card = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#FFF3D6",
            padding: 80,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 700, color: "#161616" }}>
              @{clean}
            </div>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#161616" }}>
              Pay me in $BEGFI
            </div>
            <div style={{ display: "flex", fontSize: 36, color: "#6B6B5C" }}>
              begfi.io/{clean}
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${dataUri}`}
            width={420}
            height={420}
            style={{ border: "8px solid #161616", borderRadius: 24 }}
          />
        </div>
      ),
      { width: 1200, height: 630 },
    );
    const buffer = Buffer.from(await card.arrayBuffer());
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
        ...(wantsDownload ? { "content-disposition": `attachment; filename="begfi-${clean}-card.png"` } : {}),
      },
    });
  }

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
      ...(wantsDownload ? { "content-disposition": `attachment; filename="begfi-${clean}-qr.png"` } : {}),
    },
  });
}
