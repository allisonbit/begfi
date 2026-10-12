import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Watchlist toggles and alert switches.
 *
 * Written through the caller's session; RLS (`watchlist_own`) enforces that a
 * signed-in user touches only their own rows. Toggling star is an upsert /
 * delete by (profile = auth.uid(), token), so a browser cannot star a token
 * into someone else's list even with a crafted body.
 */
const Body = z.union([
  z.object({
    action: z.literal("toggle"),
    tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    watched: z.boolean(),
  }),
  z.object({
    action: z.literal("alerts"),
    tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    alertOnMove: z.boolean().optional(),
    alertOnGraduation: z.boolean().optional(),
  }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That watchlist request doesn't parse." }, { status: 400 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const token = parsed.data.tokenAddress.toLowerCase();

  if (parsed.data.action === "toggle") {
    if (!parsed.data.watched) {
      const { error } = await sb.from("watchlist").delete().eq("token_address", token);
      if (error) return NextResponse.json({ error: "Couldn't remove it. Try again." }, { status: 503 });
      return NextResponse.json({ ok: true, watched: false });
    }

    const { error } = await sb
      .from("watchlist")
      .upsert({ profile_id: user.id, token_address: token }, { onConflict: "profile_id,token_address" });

    if (error) {
      return NextResponse.json({ error: "Couldn't save the star. Try again." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, watched: true });
  }

  // alerts: a partial update of the two toggles on an existing row.
  const patch: { alert_on_move?: boolean; alert_on_graduation?: boolean } = {};
  if (parsed.data.alertOnMove !== undefined) patch.alert_on_move = parsed.data.alertOnMove;
  if (parsed.data.alertOnGraduation !== undefined) patch.alert_on_graduation = parsed.data.alertOnGraduation;

  const { error } = await sb.from("watchlist").update(patch).eq("token_address", token);

  if (error) {
    return NextResponse.json({ error: "Couldn't update the alerts. Is the token starred?" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
