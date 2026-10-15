import { NextResponse } from "next/server";
import { z } from "zod";

import { CampaignDraft, createCampaign } from "@/lib/campaigns";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = CampaignDraft;

/**
 * POST /api/campaign/create — register a campaign.
 *
 * Owner identity is the session (never client-claimed), slug availability is
 * checked server-side, and the token's decimals are read from its own
 * contract before a row is written.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the campaign fields." }, { status: 400 });
  }

  const result = await createCampaign(profile.id, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
