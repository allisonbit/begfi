import { NextResponse } from "next/server";

import { isAdminWallet, reviewSubmission } from "@/lib/earn";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/review — approve or reject one pending submission.
 *
 * Admin-only, and the check is the SIGNED-IN wallet against the allowlist —
 * not a body field, not a header, not coercion of the user maker claim.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile || !isAdminWallet(profile.wallet_address)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: { id?: string; action?: string } | null = null;
  try {
    body = (await request.json()) as { id?: string; action?: string };
  } catch {
    body = null;
  }
  const id = body?.id ?? "";
  const action = body?.action ?? "";

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Missing submission id." }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const result = await reviewSubmission(id, action);
  switch (result) {
    case "ok":
      return NextResponse.json({ ok: true });
    case "not-found":
      return NextResponse.json({ error: "No such submission." }, { status: 404 });
    case "state":
      return NextResponse.json({ error: "Already reviewed." }, { status: 409 });
    case "pool":
      return NextResponse.json({ error: "Pool can't cover that reward. Top it up first." }, { status: 409 });
    default:
      return NextResponse.json({ error: "Database write failed." }, { status: 500 });
  }
}
