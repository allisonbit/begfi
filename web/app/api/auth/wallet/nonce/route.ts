import { NextResponse } from "next/server";
import { z } from "zod";
import { WALLET_NONCE_COOKIE, createChallenge } from "@/lib/wallet-auth";

/**
 * Issue a sign-in challenge.
 *
 * The sealed nonce goes into an HttpOnly cookie rather than the response body,
 * so a script on another origin cannot read it and cannot start a challenge it
 * then completes somewhere else.
 */
const Body = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Not an address."),
  chainId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid sign-in request." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  let challenge;
  try {
    challenge = createChallenge({
      address: parsed.data.address,
      chainId: parsed.data.chainId,
      origin,
    });
  } catch {
    // Thrown when no server secret is set. Say so plainly instead of returning a
    // challenge that could never be verified.
    return NextResponse.json({ error: "Sign-in isn't configured on this deployment." }, { status: 503 });
  }

  const response = NextResponse.json({ message: challenge.message });
  response.cookies.set(WALLET_NONCE_COOKIE, challenge.sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });

  return response;
}
