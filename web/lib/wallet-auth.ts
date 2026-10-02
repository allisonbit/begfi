import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Wallet sign-in (spec §7.3). A person proves they control an address by signing
 * a challenge; we verify it and mint them a normal Supabase session.
 *
 * Adapted from bug-protocol's `lib/wallet-auth.ts`, which is the working version
 * of this on the same stack. The shape is worth keeping:
 *
 * - The nonce is STATELESS: `ts.nonce` sealed with an HMAC and handed to the
 *   browser in an HttpOnly cookie. No table, no cleanup job, and a signature
 *   cannot be replayed from another origin or after five minutes.
 *
 * - The account is keyed by a deterministic, NON-DELIVERABLE email derived from
 *   the address (`0x...@wallet.invalid`). A wallet identity is therefore its own
 *   account and never entangled with anything a user typed.
 *
 * - The session is minted by rotating an EPHEMERAL RANDOM PASSWORD and calling
 *   `signInWithPassword`, rather than by admin-generating a magic link. An
 *   admin-generated link carries no PKCE code verifier, so the SSR client's
 *   exchange can never complete; this does, and the password is never stored,
 *   shown, or reused — it is replaced on every sign-in.
 *
 * Unlike bug-protocol, sign-in does NOT create a profile row. A BegFi account is
 * not usable until it has a username, and that claim is a separate, atomic step
 * (`begfi.claim_username`) taken on the home page. Creating a profile here would
 * mean a half-made account with no link, which is exactly the state the product
 * has no UI for.
 */

export const WALLET_NONCE_COOKIE = "beg_wallet_nonce";

const NONCE_TTL_MS = 5 * 60 * 1000;
const STATEMENT = "Sign in to BegFi. This signature is free and sends no transaction.";

function secret(): string | null {
  const s = process.env.WALLET_AUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return s.length >= 16 ? s : null;
}

function seal(nonce: string): string {
  const key = secret();
  if (!key) throw new Error("Wallet sign-in isn't configured (no server secret).");
  const ts = Date.now().toString(36);
  const mac = createHmac("sha256", key).update(`${ts}.${nonce}`).digest("base64url");
  return `${ts}.${nonce}.${mac}`;
}

/** Validate a sealed nonce and return the raw nonce, or null if forged/expired. */
function open(sealed: string): string | null {
  const key = secret();
  if (!key) return null;

  const parts = sealed.split(".");
  if (parts.length !== 3) return null;

  const [ts, nonce, mac] = parts;
  const expected = createHmac("sha256", key).update(`${ts}.${nonce}`).digest("base64url");

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // throw itself would leak the comparison's outcome.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const issued = parseInt(ts, 36);
  if (!Number.isFinite(issued) || Date.now() - issued > NONCE_TTL_MS) return null;

  return nonce;
}

/** The EIP-191 message a wallet signs. Human-readable on purpose: whatever the
 *  person sees in their wallet is the thing they are actually agreeing to. */
export function buildMessage(input: {
  address: string;
  chainId: number;
  origin: string;
  nonce: string;
  issuedAt: string;
}): string {
  let host = input.origin;
  try {
    host = new URL(input.origin).host;
  } catch {
    /* keep the raw origin */
  }

  return [
    `${host} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    STATEMENT,
    "",
    `URI: ${input.origin}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}

export function createChallenge(input: { address: string; chainId: number; origin: string }): {
  message: string;
  sealed: string;
} {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  return {
    message: buildMessage({ ...input, nonce, issuedAt }),
    sealed: seal(nonce),
  };
}

type Parsed = { address: string; nonce: string; origin: string | null };

export function parseMessage(message: string): Parsed | null {
  const lines = message.split("\n");
  const address = (lines[1] ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  const nonce = /^Nonce: (.+)$/m.exec(message)?.[1]?.trim();
  if (!nonce) return null;

  const uri = /^URI: (.+)$/m.exec(message)?.[1]?.trim() ?? null;
  return { address, nonce, origin: uri };
}

export type WalletSignInResult =
  | { ok: true; address: string; userId: string }
  | { ok: false; error: string };

/**
 * Verify a signed challenge and establish a session for that wallet's account.
 * On success the auth cookies are set on the response by `signInWithPassword`.
 */
export async function verifyWalletSignature(input: {
  message: string;
  signature: string;
  sealed: string | null;
  origin: string;
}): Promise<WalletSignInResult> {
  const { message, signature, sealed, origin } = input;

  const parsed = parseMessage(message);
  if (!parsed) return { ok: false, error: "That isn't a valid sign-in message." };

  // 1. The message must be the challenge we issued, to this origin, unexpired.
  if (!sealed) return { ok: false, error: "Sign-in challenge expired. Please try again." };

  const expectedNonce = open(sealed);
  if (!expectedNonce || expectedNonce !== parsed.nonce) {
    return { ok: false, error: "Sign-in challenge expired. Please try again." };
  }

  if (parsed.origin && parsed.origin !== origin) {
    return { ok: false, error: "This signature was made for a different site." };
  }

  // 2. The signature must come from the address named in the message.
  let valid = false;
  try {
    valid = await verifyMessage({
      address: parsed.address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }

  if (!valid) return { ok: false, error: "That signature doesn't match the wallet address." };

  // 3. Find or create the account belonging to this wallet.
  const address = parsed.address;
  const email = `${address.toLowerCase()}@wallet.invalid`;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "This deployment isn't configured for sign-in yet." };
  }

  const password = randomBytes(24).toString("base64url");
  let userId: string | null = null;

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { wallet: address, wallet_signin: true },
  });

  if (created.data?.user) {
    userId = created.data.user.id;
  } else if (created.error && !/registered|exists/i.test(created.error.message)) {
    return { ok: false, error: created.error.message };
  } else {
    // The account already exists. Resolve it and rotate its password.
    const found = await admin.auth.admin.generateLink({ type: "magiclink", email });
    userId = found.data?.user?.id ?? null;
    if (!userId) return { ok: false, error: "Could not establish a session for this wallet." };

    const rotated = await admin.auth.admin.updateUserById(userId, { password });
    if (rotated.error) return { ok: false, error: rotated.error.message };
  }

  // 4. Sign in on the cookie-bound server client, which sets the auth cookies on
  //    this response, so the browser is signed in the moment it navigates.
  const sb = await createClient();
  const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
  if (signInErr) return { ok: false, error: signInErr.message };

  return { ok: true, address, userId };
}
