import { NextResponse } from "next/server";

import { isAdminWallet, updateEarnSettings } from "@/lib/earn";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/settings — the admin's knobs, in display units.
 *
 * Field names say which unit they carry: `*Display` values are counted in
 * whole $BEGFI (the number a human types: "10000"), never base units. The
 * library converts, validates, and refuses incoherent sets (a total below
 * what is already owed) rather than applying half of one.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile || !isAdminWallet(profile.wallet_address)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) {
    return NextResponse.json({ error: "Send settings fields." }, { status: 400 });
  }

  const num = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };

  // No daily limit: the per-account posting caps were removed with the
  // wallet-only claim rule, and an admin knob nothing reads is worse than
  // none. A `dailyLimit` in the body is ignored.
  const result = await updateEarnSettings({
    rewardPerPostDisplay: num(body.rewardPerPostDisplay),
    poolTotalDisplay: num(body.poolTotalDisplay),
    poolTopUpDisplay: num(body.poolTopUpDisplay),
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Update failed." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
