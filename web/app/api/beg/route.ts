import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a beg.
 *
 * Written through the CALLER'S OWN session rather than the service role, so the
 * RLS policy `begs_insert_own` is what enforces that a row belongs to the person
 * creating it. There is no ownership check in this file on purpose: an
 * authorisation rule written twice is one that can disagree with itself, and the
 * policy already cannot be bypassed from here.
 *
 * `goal` arrives as a STRING of base units, not a number. Token amounts do not
 * survive a JavaScript float, and the client has already parsed it with the same
 * strict parser used for sends — so this re-validates the shape and stores it,
 * rather than trusting a value that has been through JSON.
 */
const Body = z.object({
  body: z.string().trim().min(1, "Write something first.").max(180, "That's too long."),
  goal: z
    .string()
    .regex(/^\d{1,40}$/, "That amount doesn't look right.")
    .nullable()
    .optional(),
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

  /*
   * A LIMIT HERE, AND ONLY HERE, AMONG THE WRITE ROUTES.
   *
   * Beg creation is the one place repetition multiplies harm: every beg is a
   * public page with a generated share image, so a script could fill the site
   * with them, and each one costs a database row and an image render.
   *
   * It is set generously on purpose. Thirty an hour is far more than a person
   * writing about what they are asking for will ever reach, and low enough that a
   * script posting thousands stops early. A limit that catches real users is a
   * bug, not a control.
   */
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 503 });
  }

  const { data: allowed, error: limitError } = await admin.rpc("check_rate_limit", {
    p_bucket: "beg_create",
    p_subject: user.id,
    p_max: 30,
    p_window: "1 hour",
  });

  // Fails OPEN. An error from the limiter must never block a legitimate write:
  // the worst case of a spammer slipping through is better than the certain case
  // of a real person being unable to write a beg.
  if (!limitError && allowed === false) {
    return NextResponse.json(
      { error: "That's a lot of begs in one hour. Try again shortly." },
      { status: 429 },
    );
  }

  // `error` is read, not caught: supabase-js returns rather than throws, so a
  // failed insert would otherwise fall through to a success response with no id.
  const { data, error } = await sb
    .from("begs")
    .insert({
      profile_id: profile.id,
      body: parsed.data.body,
      goal: parsed.data.goal ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, username: profile.username });
}
