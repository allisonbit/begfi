import { NextResponse } from "next/server";
import { USERNAME_PATTERN, isReserved } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Is this username free?
 *
 * This is a convenience for the home page's live availability field, not a
 * reservation — the authoritative claim is `POST /api/username/claim`, which is
 * atomic. A name can pass this check and be taken a moment later, and the UI has
 * to handle the claim failing for that reason rather than treating this as a lock.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u") ?? "";
  const username = raw.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }

  // Checked before the database round trip, and again inside the claim RPC.
  if (isReserved(username)) {
    return NextResponse.json({ available: false, reason: "reserved" });
  }

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle();

    return NextResponse.json({ available: !data, reason: data ? "taken" : "free" });
  } catch {
    // The backend is not configured, or is unreachable. Say "unknown" rather
    // than "available", so the UI cannot show a green tick it has not earned.
    return NextResponse.json({ available: false, reason: "unknown" }, { status: 503 });
  }
}
