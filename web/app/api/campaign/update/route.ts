import { NextResponse } from "next/server";
import { z } from "zod";

import { CampaignDraft, setCampaignVerified, updateCampaign } from "@/lib/campaigns";
import { isAdminWallet } from "@/lib/earn";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const OwnerBody = CampaignDraft.extend({ id: z.string().trim().min(1) });
const VerifyBody = z.object({
  action: z.literal("verify"),
  id: z.string().trim().min(1),
  verified: z.boolean(),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update") }).merge(OwnerBody).passthrough(),
  VerifyBody,
]);

/**
 * POST /api/campaign/update — owner edits, and the platform's verify badge.
 *
 * Two verbs, one gate each:
 *   * "update": the OWNER of the campaign edits its copy/budget/status —
 *     ownership re-checked server-side against the session profile.
 *   * "verify": ONLY an admin wallet flips `is_verified` — the trust badge
 *     is a platform editorial fact and can never be earned by the owner.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the fields." }, { status: 400 });
  }

  if (parsed.data.action === "verify") {
    if (!isAdminWallet(profile.wallet_address)) {
      return NextResponse.json({ error: "Only BegFi admins can grant the verified badge." }, { status: 403 });
    }
    const result = await setCampaignVerified(parsed.data.id, parsed.data.verified);
    return "error" in result
      ? NextResponse.json({ error: result.error }, { status: result.status })
      : NextResponse.json({ ok: true });
  }

  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });
  const { id, ...draft } = parsed.data as z.infer<typeof OwnerBody>;

  const result = await updateCampaign(profile.id, { ...draft, id });
  return "error" in result
    ? NextResponse.json({ error: result.error }, { status: result.status })
    : NextResponse.json({ ok: true });
}
