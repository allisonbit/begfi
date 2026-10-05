import { NextResponse } from "next/server";
import { USERNAME_PATTERN, isReserved } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Is this username free?
 *
 * A convenience for the home page's live availability field, not a reservation —
 * the authoritative claim is `POST /api/username/claim`, which is atomic.
 *
 *** THE ERROR THAT WAS INVISIBLE HERE ***
 *
 * This previously read only `data` and wrapped the call in try/catch. supabase-js
 * does not THROW on an API error — it returns `{ data: null, error }` — so a
 * failing query produced `data === null`, which this read as "no row, therefore
 * free". Every username reported available, including taken and reserved ones,
 * and the try/catch was dead code that never once ran.
 *
 * The failure behind it was a 406 ("Invalid schema: begfi") — the schema was not
 * exposed — which is now fixed in migration 0003. But the lesson is the general
 * one: an error must be READ, and a null result must never be mistaken for a
 * successful empty one.
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
    const { data, error } = await admin
      .from("profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      // Reported as "unknown", never as "available". A green tick that has not
      // been earned is worse than no tick: it sends someone through sign-in and
      // a claim that then fails for a reason the field already knew about.
      return NextResponse.json({ available: false, reason: "unknown" }, { status: 503 });
    }

    return NextResponse.json({ available: !data, reason: data ? "taken" : "free" });
  } catch {
    return NextResponse.json({ available: false, reason: "unknown" }, { status: 503 });
  }
}
