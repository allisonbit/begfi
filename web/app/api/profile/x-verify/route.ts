import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * X account verification — the code-post link-back that earns the tick.
 *
 * THE MECHANISM. The owner asks for a code here, posts it from their X account
 * (the intent link prefilled makes that one click), and pastes the post's URL
 * back. The server then reads that post on X's public oEmbed endpoint — no API
 * key, no OAuth — and grants the tick only when BOTH are true: the post's
 * author is the handle on the profile, and the post carries this account's
 * code. Anything short of both grants nothing.
 *
 * WHY A CODE AND NOT A FOLLOW-BACK. The account being verified is the account
 * the person already controls; the only thing that needs proving is that the
 * handle on this profile is theirs. A unique per-attempt code is the smallest
 * proof with no replay: a code is single-use (cleared on success), regenerated
 * on each start, and prove nothing to anyone who is not the profile's owner.
 *
 * Ownership comes from the session and nowhere else — every write below is
 * keyed to the signed-in caller's own profile row.
 */

const Start = z.object({ action: z.literal("start") });

const Confirm = z.object({
  action: z.literal("confirm"),
  post_url: z
    .string()
    .regex(
      /^https?:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/i,
      "Paste the full link to your post on X.",
    ),
});

const Body = z.discriminatedUnion("action", [Start, Confirm]);

/** A fresh challenge. Short, typeable, and unique enough to never collide. */
function newCode(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `BEGFI-${hex.toUpperCase()}`;
}

/**
 * The public oEmbed read. X's own publish endpoint returns the tweet's text
 * and author with no key. It is rate-limited and occasionally refuses, so a
 * failure here is reported as exactly that — "try again" — never as a
 * verification failure, because the difference matters.
 */
async function readPost(postUrl: string): Promise<{ author: string; text: string } | null> {
  try {
    const url = `https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&omit_script=1&dnt=true&theme=dark`;
    const res = await fetch(url, {
      headers: { "user-agent": "BegFi/1.0 (verification)" },
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { author_url?: string; html?: string } | null;
    if (!body) return null;
    // author_url is the profile URL (https://x.com/<handle>); the last
    // segment is the handle, whatever the scheme of the moment is.
    const author = body.author_url?.replace(/\/+$/, "").split("/").pop() ?? "";
    if (!author) return null;
    return { author, text: body.html ?? "" };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Verification is not available yet." }, { status: 503 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That isn't a valid request." },
      { status: 400 },
    );
  }

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // Both actions verify the SAVED handle: the tick belongs to the handle the
  // profile already shows, not one typed but not saved. The form gates this
  // too; routers get their own truthful answer.
  if (!profile.x_handle) {
    return NextResponse.json({ error: "Save an X username on your profile first." }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Couldn't reach verification. Try again." }, { status: 503 });
  }

  if (parsed.data.action === "start") {
    const code = newCode();
    // Issuing a new challenge revokes any old one AND the tick: a fresh
    // verification is what earns a fresh statement of the same fact.
    const { error } = await admin
      .from("profiles")
      .update({ x_verify_code: code, x_verified_at: null })
      .eq("id", profile.id);

    if (error) {
      return NextResponse.json({ error: "Couldn't start verification. Try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, code, handle: profile.x_handle });
  }

  // ---- confirm ---------------------------------------------------------------

  const { data: row, error: readError } = await admin
    .from("profiles")
    .select("x_handle, x_verify_code")
    .eq("id", profile.id)
    .single<{ x_handle: string | null; x_verify_code: string | null }>();

  if (readError || !row) {
    return NextResponse.json({ error: "Couldn't check your profile. Try again." }, { status: 503 });
  }

  const code = row.x_verify_code;
  if (!code || !row.x_handle) {
    return NextResponse.json(
      { error: "Get a verification code first." },
      { status: 409 },
    );
  }

  const post = await readPost(parsed.data.post_url);
  if (!post) {
    return NextResponse.json(
      { error: "Could not read that post from X just now. Check the link or try again in a moment." },
      { status: 503 },
    );
  }

  if (post.author.toLowerCase() !== row.x_handle.toLowerCase()) {
    return NextResponse.json(
      { error: `That post is not from @${row.x_handle}. Post the code from that account.` },
      { status: 400 },
    );
  }

  if (!post.text.includes(code)) {
    return NextResponse.json(
      { error: "That post does not contain your BegFi code." },
      { status: 400 },
    );
  }

  // Both checks passed. The tick is stamped now and the code is spent — a
  // code that verified once can never verify again.
  const { error: stampError } = await admin
    .from("profiles")
    .update({ x_verified_at: new Date().toISOString(), x_verify_code: null })
    .eq("id", profile.id);

  if (stampError) {
    return NextResponse.json({ error: "Verified, but couldn't save it. Try once more." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
