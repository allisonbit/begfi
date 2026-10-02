import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { WALLET_NONCE_COOKIE, verifyWalletSignature } from "@/lib/wallet-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Verify a signed challenge and establish a session.
 *
 * The nonce cookie is read here rather than from the body: it is the one piece
 * of the challenge an attacker cannot supply, because only this origin's
 * HttpOnly cookie jar holds it.
 */
const Body = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Not a signature."),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid sign-in response." }, { status: 400 });
  }

  const jar = await cookies();
  const sealed = jar.get(WALLET_NONCE_COOKIE)?.value ?? null;
  const origin = new URL(request.url).origin;

  const result = await verifyWalletSignature({
    message: parsed.data.message,
    signature: parsed.data.signature,
    sealed,
    origin,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  // A nonce is single-use in effect: the cookie is cleared so the same signed
  // message cannot be replayed against this endpoint.
  jar.delete(WALLET_NONCE_COOKIE);

  // Tell the client whether this account still needs a username, so it can send
  // a first-time wallet straight to the claim step instead of a dashboard with
  // nothing in it.
  let hasProfile = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("username")
      .eq("id", result.userId)
      .maybeSingle();
    hasProfile = Boolean(data);
  } catch {
    hasProfile = false;
  }

  return NextResponse.json({ ok: true, address: result.address, hasProfile });
}
