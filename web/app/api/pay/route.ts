import { NextResponse } from "next/server";
import { z } from "zod";

import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { parseAmount } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a pay link, or close and reopen one.
 *
 * WRITTEN THROUGH THE CALLER'S OWN SESSION, like `/api/beg`: the RLS policies
 * `pay_links_insert_own` and `pay_links_update_own` are what enforce that a link
 * belongs to the person acting, so there is no ownership check to write twice
 * and get wrong. The only thing the service role is used for here is the rate
 * limiter, which is a shared counter and not a row anyone owns.
 *
 * THE AMOUNT ARRIVES AS A DECIMAL STRING ("20", "0.5") and is parsed with the
 * same strict parser the send flow uses, then stored as BASE UNITS text. Token
 * amounts do not survive a JavaScript float — `parseFloat("0.1") * 1e18` is not
 * `10n ** 17n` — and an ask that rounds is an ask whose page disagrees with the
 * transaction it is waiting for.
 */
const Create = z.object({
  amount: z
    .string()
    .trim()
    .max(40)
    // Empty means "any amount": the open-ended ask is a real request, not a
    // failure to fill the field in.
    .optional()
    .nullable(),
  memo: z.string().trim().min(1).max(90).optional().nullable(),
});

const Toggle = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export async function POST(request: Request) {
  const parsed = Create.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That isn't a valid request." },
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
   * An ask has to be an ask for the token that exists. While `BEG_TOKEN_ADDRESS`
   * is null the product cannot move money, and a link that promised otherwise
   * would be exactly the working-looking control this codebase refuses to render.
   */
  if (!BEG_TOKEN_ADDRESS) {
    return NextResponse.json(
      { error: "Pay links need the token configured on this deployment." },
      { status: 503 },
    );
  }

  // The amount, strictly. `parseAmount` returns null for anything it does not
  // fully understand — "1,0oo" must be rejected, never coerced into 100.
  const raw = parsed.data.amount?.trim() ?? "";
  let amount: string | null = null;
  if (raw !== "") {
    const wei = parseAmount(raw);
    if (wei === null) {
      return NextResponse.json({ error: "That amount doesn't look like a number." }, { status: 400 });
    }
    if (wei <= 0n) {
      return NextResponse.json({ error: "An ask of zero isn't an ask." }, { status: 400 });
    }
    amount = wei.toString();
  }

  // A per-hour ceiling, generous on purpose: a person making a few asks for
  // different things is the normal case; a script making thousands stops early.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 503 });
  }

  const { data: allowed, error: limitError } = await admin.rpc("check_rate_limit", {
    p_bucket: "pay_link_create",
    p_subject: user.id,
    p_max: 20,
    p_window: "1 hour",
  });

  // Fails OPEN, as at every other write: a limiter outage must not be able to
  // stop a real person from asking to be paid.
  if (!limitError && allowed === false) {
    return NextResponse.json(
      { error: "That's a lot of requests in one hour. Try again shortly." },
      { status: 429 },
    );
  }

  const { data, error } = await sb
    .from("pay_links")
    .insert({
      owner_id: profile.id,
      token_address: BEG_TOKEN_ADDRESS.toLowerCase(),
      amount,
      memo: parsed.data.memo?.trim() || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: Request) {
  const parsed = Toggle.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid change." }, { status: 400 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  /*
   * `select("id")` after the update is the honest way to notice that nothing
   * happened. PostgREST applies the RLS policy as a row filter, so closing
   * someone else's link is not an error — it is zero rows — and a bare success
   * response would tell the caller it worked.
   */
  const { data, error } = await sb
    .from("pay_links")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return NextResponse.json({ error: "Couldn't update that link." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "That link isn't yours." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, isActive: parsed.data.isActive });
}
