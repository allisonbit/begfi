import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a beg.
 *
 * Written through the CALLER'S OWN session rather than the service role, so the
 * RLS policy `begs_insert_own` is what enforces that a row belongs to the person
 * creating it. There is no ownership check in this file on purpose: an
 * authorisation rule written twice is one that can disagree with itself, and the
 * policy already cannot be bypassed from here.
 */
const Body = z.object({
  body: z.string().trim().min(1, "Write something first.").max(180, "That's too long."),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That isn't a valid beg." },
      { status: 400 },
    );
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // The profile is the beg's owner, and a signed-in wallet may not have claimed a
  // username yet — in which case there is nothing to attach a beg to.
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle<{ id: string; username: string }>();

  if (profileError) {
    return NextResponse.json({ error: "Couldn't reach your profile." }, { status: 503 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Claim a username first." }, { status: 409 });
  }

  // `error` is read, not caught: supabase-js returns rather than throws, so a
  // failed insert would otherwise fall through to a success response with no id.
  const { data, error } = await sb
    .from("begs")
    .insert({ profile_id: profile.id, body: parsed.data.body })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, username: profile.username });
}
