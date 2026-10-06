import { NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, decodeEventLog, http } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { erc20Abi } from "@/lib/erc20";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { LaunchMode } from "@/lib/types";

/**
 * Record a launch into `begfi.launches` — the membership table that decides
 * which tokens BegFi's own pages serve.
 *
 * WHY THIS ROUTE EXISTS. The factory is shared: anyone on Robinhood Chain can
 * call it, so reading the factory directly would put strangers' tokens under
 * BegFi's name. This route is the difference between "the factory produced it"
 * and "it launched from here" — a token only gets a page and a place on
 * /explore if the chain proves it was signed by the launcher's own wallet.
 *
 * THE BROWSER'S CLAIM IS NOTHING. The session, the receipt and the event are
 * read server-side; the body's token and tx hash are only pointers for the
 * server to verify, never facts. Anything else would let a browser mint a
 * catalog entry out of thin air.
 *
 * Written by the service role, exactly as 0001's comment on `launches`
 * describes: "written by the service role after a confirmed deploy".
 */
const Body = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "That isn't a token address."),
  txHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/i, "That isn't a transaction hash."),
  mode: z.enum(["genesis", "standard"]),
  image: z
    .string()
    .trim()
    .url("That logo URL doesn't look like a URL.")
    .startsWith("https://", "The logo URL has to be https.")
    .optional(),
});

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That isn't a valid launch." },
      { status: 400 },
    );
  }
  const { token, txHash, mode, image } = parsed.data;

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // The wallet is read from the profile for the same reason as the beg route:
  // it is the address that claimed an identity here, and the one the chain
  // must name as the launch's deployer.
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("id, username, wallet_address")
    .eq("id", user.id)
    .maybeSingle<{ id: string; username: string; wallet_address: string }>();

  if (profileError) {
    return NextResponse.json({ error: "Couldn't reach your profile." }, { status: 503 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Claim a username first." }, { status: 409 });
  }

  const wallet = profile.wallet_address.toLowerCase();

  // ---- the chain decides what happened -------------------------------------

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return NextResponse.json(
      { error: "Couldn't find that transaction on the chain." },
      { status: 404 },
    );
  }

  let curve: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: ponsFactoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "TokenLaunched") continue;
      if ((decoded.args.token as string).toLowerCase() !== token.toLowerCase()) continue;
      if ((decoded.args.deployer as string).toLowerCase() !== wallet) continue;

      curve = decoded.args.curve as `0x${string}`;
      break;
    } catch {
      /* not our event */
    }
  }

  if (!curve) {
    return NextResponse.json(
      { error: "The chain doesn't confirm a launch from your wallet at that address." },
      { status: 403 },
    );
  }

  // The admin client exists before the reads so both the blocklist check and
  // the write share it.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 503 });
  }

  // Name and ticker come from the token contract itself, not from the browser:
  // the blocklist is only meaningful against what is actually on-chain.
  let name: string;
  let ticker: string;
  try {
    [name, ticker] = await Promise.all([
      client.readContract({ abi: erc20Abi, address: token as `0x${string}`, functionName: "name" }),
      client.readContract({ abi: erc20Abi, address: token as `0x${string}`, functionName: "symbol" }),
    ]);
  } catch {
    return NextResponse.json(
      { error: "The token exists but couldn't be read off the chain. Try again shortly." },
      { status: 503 },
    );
  }

  // The blocklist (spec §9.5) is enforced here, server-side, against the
  // on-chain name and ticker — but only for standard launches. Genesis skips
  // it by design: the genesis launch is $BEG itself, and the form cannot reach
  // that mode until $BEG exists.
  if (mode === "standard") {
    const { data: blocked } = await admin.from("launch_blocklist").select("term");
    const terms = (blocked ?? []).map((row) => row.term.toLowerCase());
    const tickerLower = ticker.toLowerCase();
    const nameLower = name.toLowerCase();

    // Exact match for a ticker; word-boundary match for a name, so "Ethereum
    // Classic" is not caught by "eth" but "Robinhood Dogs" is caught by
    // "robinhood".
    const hit = terms.find(
      (term) => tickerLower === term || new RegExp(`\\b${escapeRegex(term)}\\b`).test(nameLower),
    );
    if (hit) {
      return NextResponse.json(
        { error: `"${hit}" is reserved on BegFi — launches may not impersonate it.` },
        { status: 409 },
      );
    }
  }

  // One row per confirmed launch, for both modes. The launch itself is
  // already bounded by the fee the factory charges, so this write needs no
  // rate limit of its own: it cannot be called without a transaction that
  // paid one.
  const { error: insertError } = await admin.from("launches").upsert(
    {
      token_address: token.toLowerCase(),
      launcher_wallet: wallet,
      name,
      ticker,
      image_url: image ?? null,
      mode,
      splitter_address: null,
      tx_hash: txHash.toLowerCase(),
    },
    { onConflict: "token_address" },
  );

  if (insertError) {
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, token, curve, name, ticker });
}
