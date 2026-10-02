import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The indexer (spec §7.4).
 *
 * Reads `Transfer` events of the $BEG contract and records the ones addressed to
 * a registered wallet. Totals and supporter counts are computed from what this
 * writes, so the rule that matters is here: **a transfer counts only once it is
 * confirmed on-chain.** The browser is never asked what happened, and nothing a
 * client sends can create a row.
 *
 * HOW IT ADVANCES. It keeps a cursor in `begfi.app_config` — the last block it
 * has fully processed — and each run scans a bounded window forward from there.
 * A bounded window matters more than it looks: `eth_getLogs` over an unbounded
 * range is how an indexer gets rate-limited off a public RPC, and Robinhood's
 * public endpoint is documented as not for production use. If the window cannot
 * keep up, the fix is a dedicated provider, not a bigger number here.
 *
 * A FILTERED QUERY IS NOT USED for the `to` address. The topic filter accepts a
 * list, but it is built from every registered wallet and would grow without
 * bound; instead the token's logs for the window are fetched and matched against
 * the current wallet set in memory. That is one request per run regardless of
 * how many users there are.
 *
 *** HOW OFTEN THIS ACTUALLY RUNS ***
 *
 * vercel.json schedules it once a day, at 03:17. That is not a design choice —
 * Vercel's Hobby plan rejects any cron that runs more than once per day, and a
 * deploy with a `*​/5 * * * *` schedule fails outright with "Hobby accounts are
 * limited to daily cron jobs". The build compiles, then the deploy is refused.
 *
 * So on Hobby this endpoint is a once-daily safety net, and a transfer can take
 * up to 24 hours to appear in a total. For a payment page that is too slow, and
 * there are two honest ways out: Vercel Pro (per-minute crons), or any external
 * scheduler calling this URL with the CRON_SECRET bearer token — the route does
 * not care who calls it, only that they are authorised. Until then the indexer
 * is correct but slow, and the app says totals come from confirmed transfers
 * without promising how quickly.
 */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Blocks per run. Small enough for a rate-limited public RPC to answer. */
const BLOCK_WINDOW = 2_000n;

/** How far behind the chain head to stop, so a reorg cannot be indexed as final. */
const CONFIRMATIONS = 5n;

const CURSOR_KEY = "index_cursor_block";

export async function GET(request: Request) {
  // Vercel sends this header on a scheduled invocation. Without the check the
  // endpoint is a way for anyone to make this deployment do unbounded RPC work.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!BEG_TOKEN_ADDRESS) {
    // Expected until $BEG is actually launched. Not an error: there is nothing
    // to index, and saying so is more useful than a stack trace.
    return NextResponse.json({ ok: true, skipped: "no $BEG token address configured" });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined),
  });

  try {
    const head = await client.getBlockNumber();
    const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

    const { data: cursorRow } = await admin
      .from("app_config")
      .select("value")
      .eq("key", CURSOR_KEY)
      .maybeSingle<{ value: string }>();

    // No cursor yet: start at the tip rather than at genesis. A first run that
    // tried to scan the whole chain would time out and record nothing, and every
    // transfer before the indexer existed belongs to accounts that did not exist
    // either.
    const from = cursorRow?.value ? BigInt(cursorRow.value) : safeHead;

    if (from >= safeHead) {
      return NextResponse.json({ ok: true, indexed: 0, note: "already at head" });
    }

    const to = from + BLOCK_WINDOW > safeHead ? safeHead : from + BLOCK_WINDOW;

    const logs = await client.getLogs({
      address: BEG_TOKEN_ADDRESS as `0x${string}`,
      event: TRANSFER_EVENT,
      fromBlock: from + 1n,
      toBlock: to,
    });

    const { data: profiles } = await admin
      .from("profiles")
      .select("wallet_address")
      .eq("is_hidden", false);

    const watched = new Set((profiles ?? []).map((p: { wallet_address: string }) => p.wallet_address));

    const matched = logs.filter((log) => {
      const to = log.args.to?.toLowerCase();
      return Boolean(to && watched.has(to));
    });

    if (matched.length > 0) {
      // Timestamps come from the block, not from now(): the time a transfer
      // happened is a property of the chain, and `on conflict do nothing` makes
      // a re-run over an overlapping window idempotent.
      const blocks = await Promise.all(
        [...new Set(matched.map((l) => l.blockNumber))].map(async (blockNumber) => {
          const block = await client.getBlock({ blockNumber: blockNumber! });
          return [blockNumber!.toString(), new Date(Number(block.timestamp) * 1000).toISOString()] as const;
        }),
      );
      const times = new Map(blocks);

      await admin.from("transfers").upsert(
        matched.map((log) => ({
          tx_hash: log.transactionHash,
          log_index: log.logIndex,
          token_address: BEG_TOKEN_ADDRESS,
          from_address: log.args.from!.toLowerCase(),
          to_address: log.args.to!.toLowerCase(),
          amount: log.args.value!.toString(),
          block_number: Number(log.blockNumber),
          block_time: times.get(log.blockNumber!.toString())!,
        })),
        { onConflict: "tx_hash,log_index", ignoreDuplicates: true },
      );
    }

    await admin.from("app_config").upsert(
      { key: CURSOR_KEY, value: to.toString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    return NextResponse.json({
      ok: true,
      scanned: { from: (from + 1n).toString(), to: to.toString() },
      logs: logs.length,
      indexed: matched.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The cursor is deliberately NOT advanced on failure, so the next run
    // retries the same window rather than skipping it.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
