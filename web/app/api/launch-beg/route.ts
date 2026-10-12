import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Create or update the caller's launch beg.
 *
 * Written through the CALLER'S OWN session so the RLS policies
 * (`launch_begs_insert_own` / `_update_own`) do the authorisation, as with
 * begs. Funded state is NOT settable from here: a beg is marked funded by
 * /api/launch/confirm after the chain proves a real launch happened — a
 * browser that claims "funded" without a transaction gets nothing.
 */
const Close = z.object({
  action: z.literal("close"),
  id: z.string().uuid(),
});

const Create = z.object({
  action: z.literal("create"),
  tokenName: z.string().trim().min(1).max(32),
  tokenTicker: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, "2 to 10 letters or digits.")),
  oneLiner: z.string().trim().min(1).max(180),
  goal: z.string().regex(/^\d{1,40}$/, "That goal doesn't look right."),
});

const Body = z.union([Create, Close]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That doesn't look right." },
      { status: 400 },
    );
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle<{ id: string }>();
  if (!profile) return NextResponse.json({ error: "Claim a username first." }, { status: 409 });

  if (parsed.data.action === "close") {
    return NextResponse.json(
      { error: "Closing out is done by launching. When the launch confirms, the beg is marked funded automatically." },
      { status: 409 },
    );
  }

  // Create. The partial unique index (one open ask per profile) is the
  // enforcement; a violation surfaces as a PostgREST error and we surface it
  // as the one sentence the creator needs.
  const { data: insertData, error } = await sb
    .from("launch_begs")
    .insert({
      profile_id: profile.id,
      token_name: parsed.data.tokenName,
      token_ticker: parsed.data.tokenTicker,
      one_liner: parsed.data.oneLiner,
      goal: parsed.data.goal,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    const isDup = /duplicate key|launch_begs_one_active/i.test(error.message);
    return NextResponse.json(
      {
        error: isDup
          ? "You already have an open beg to launch. Launch to close it, then open the next."
          : "Couldn't save the beg to launch. Try again.",
      },
      { status: isDup ? 409 : 503 },
    );
  }

  return NextResponse.json({ ok: true, id: insertData?.id ?? insertData });
}
