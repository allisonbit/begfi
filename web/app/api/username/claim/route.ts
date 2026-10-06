import { NextResponse } from "next/server";
import { z } from "zod";
import { USERNAME_PATTERN, isReserved } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim a username for the signed-in wallet.
 *
 * The wallet address comes from the SESSION, never from the request body. Taking
 * it from the client would let someone claim a username pointing at an address
 * they do not control — which is the whole product, turned into a phishing tool.
 *
 * The reserved-list check and the insert both happen inside
 * `begfi.claim_username`, in one transaction, so a reserved name cannot slip
 * through the window a check-then-insert would leave open.
 */
const Body = z.object({
  username: z.string().min(1).max(20),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid username." }, { status: 400 });
  }

  const username = parsed.data.username.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: "Usernames are 3 to 20 characters of a-z, 0-9 and _." }, { status: 400 });
  }
  if (isReserved(username)) {
    return NextResponse.json({ error: "That name is reserved." }, { status: 409 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const wallet = typeof user.user_metadata?.wallet === "string" ? user.user_metadata.wallet : null;
  if (!wallet) {
    return NextResponse.json({ error: "This session has no wallet attached." }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "This deployment isn't configured yet." }, { status: 503 });
  }

  /*
   * NO RATE LIMIT HERE, DELIBERATELY.
   *
   * This route used to allow five claims an hour, and that was wrong twice over.
   *
   * It protected nothing. A claim inserts a row keyed by the caller's auth user
   * id, which is the primary key of `profiles` — so an account can hold exactly
   * one username, and a second attempt fails on a primary-key violation before
   * any counter is consulted. The limit was guarding a door that is welded shut.
   *
   * And it cost real users. Someone who mistyped, or who signed in and out while
   * deciding, could be locked out of claiming the one name they came for — while
   * the abuse it imagined is not reachable by pressing the button more often.
   *
   * Rate limits belong where repetition genuinely multiplies harm: spam that
   * other people have to look at. That is beg creation, not claiming a single
   * permanent name.
   */

  const { data, error } = await admin.rpc("claim_username", {
    p_user: user.id,
    p_wallet: wallet,
    p_username: username,
  });

  if (error) {
    // Raisecodes from the RPC, turned into the messages the form shows.
    if (/username_reserved/.test(error.message)) {
      return NextResponse.json({ error: "That name is reserved." }, { status: 409 });
    }
    if (/invalid_username/.test(error.message)) {
      return NextResponse.json({ error: "Usernames are 3 to 20 characters of a-z, 0-9 and _." }, { status: 400 });
    }
    if (/duplicate key|unique/i.test(error.message)) {
      return NextResponse.json({ error: "That username was just taken." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not claim that username." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, username: (data as { username: string }).username });
}
