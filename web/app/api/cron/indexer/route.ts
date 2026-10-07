import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { ponsCurveAbi } from "@/lib/curve";
import { ponsFactoryAbi, PONS_FACTORY } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The indexer (spec §7.4).
 *
 * Two independent scans, one cursor each:
 *
 *  1. TRANSFERS. Reads `Transfer` events of the $BEG contract and records the
 *     ones addressed to a registered wallet. Totals and supporter counts are
 *     computed from what this writes, so the rule that matters is here:
 *     **a transfer counts only once it is confirmed on-chain.** The browser is
 *     never asked what happened, and nothing a client sends can create a row.
 *
 *  2. TRADES. Reads `CurveBuy` and `CurveSell` off every curve in the launch
 *     catalog — BegFi's own tokens only, never the whole factory. This is what
 *     lets the explore page show 24h volume, trade counts and price change
 *     like odys does: those numbers are trade events, and now they are
 *     recorded rather than invented.
 *
 * HOW IT ADVANCES. Each scan keeps its own cursor in `begfi.app_config` — the
 * last block it has fully processed — and each run scans a bounded window
 * forward from there. A bounded window matters more than it looks:
 * `eth_getLogs` over an unbounded range is how an indexer gets rate-limited
 * off a public RPC, and Robinhood's public endpoint is documented as not for
 * production use. If a window cannot keep up, the fix is a dedicated provider,
 * not a bigger number here. The cursors are separate so a stalled scan cannot
 * hold the other one back.
 *
 * A FILTERED QUERY IS NOT USED for the transfer `to` address. The topic filter
 * accepts a list, but it is built from every registered wallet and would grow
 * without bound; instead the token's logs for the window are fetched and
 * matched against the current wallet set in memory. That is one request per
 * run regardless of how many users there are. The trade scan is the mirror
 * image: the catalog is small and known, so the curve ADDRESSES are the filter.
 *
 *** HOW OFTEN THIS ACTUALLY RUNS ***
 *
 * vercel.json schedules it once a day, at 03:17. That is not a design choice —
 * Vercel's Hobby plan rejects any cron that runs more than once per day, and a
 * deploy with a `*​/5 * * * *` schedule fails outright with "Hobby accounts are
 * limited to daily cron jobs". The build compiles, then the deploy is refused.
 *
 * So on Hobby this endpoint is a once-daily safety net, and a transfer or a
 * trade can take up to 24 hours to appear in a figure. For a payment page that
 * is too slow, and there are two honest ways out: Vercel Pro (per-minute
 * crons), or any external scheduler calling this URL with the CRON_SECRET
 * bearer token — the route does not care who calls it, only that they are
 * authorised. Until then the indexer is correct but slow, and the app says
 * numbers come from confirmed on-chain events without promising how quickly.
 */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Blocks per run. Small enough for a rate-limited public RPC to answer. */
const BLOCK_WINDOW = 2_000n;

/** How far behind the chain head to stop, so a reorg cannot be indexed as final. */
const CONFIRMATIONS = 5n;

const TRANSFER_CURSOR_KEY = "index_cursor_block";
const TRADE_CURSOR_KEY = "trade_cursor_block";

/** Catalog rows whose curve address is backfilled per run. Bounds RPC calls. */
const CURVE_BACKFILL_PER_RUN = 25;

/** Catalog size cap. The catalog is gated and small; this is a ceiling, not a goal. */
const MAX_CATALOG = 500;

type TradeRow = {
  tx_hash: string;
  log_index: number;
  token_address: string;
  curve_address: string;
  trader: string;
  is_buy: boolean;
  quote_amount: string;
  token_amount: string;
  block_number: number;
  block_time: string;
};

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

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(
      process.env.ALCHEMY_RPC_URL?.trim() || process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined,
    ),
  });

  try {
    const head = await client.getBlockNumber();
    const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

    // The scans are independent and either may be skipped: transfers need a
    // $BEG address to exist at all, trades need at least one catalog row.
    const transfers = await indexTransfers(client, admin, safeHead);
    const trades = await indexTrades(client, admin, safeHead);

    return NextResponse.json({ ok: true, transfers, trades });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Cursors are deliberately NOT advanced on failure, so the next run
    // retries the same window rather than skipping it.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ------------------------------------------------------------------------- */
/* Scan 1: $BEG transfers to registered wallets                              */
/* ------------------------------------------------------------------------- */

async function indexTransfers(
  client: ReturnType<typeof createPublicClient>,
  admin: ReturnType<typeof createAdminClient>,
  safeHead: bigint,
) {
  if (!BEG_TOKEN_ADDRESS) {
    // Expected until $BEG is actually launched. Not an error: there is nothing
    // to index, and saying so is more useful than a stack trace.
    return { skipped: "no $BEG token address configured" };
  }

  const from = (await readCursor(admin, TRANSFER_CURSOR_KEY)) ?? safeHead;

  if (from >= safeHead) {
    return { indexed: 0, note: "already at head" };
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
    const times = await blockTimes(client, matched.map((l) => l.blockNumber!));

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
    { key: TRANSFER_CURSOR_KEY, value: to.toString(), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return {
    scanned: { from: (from + 1n).toString(), to: to.toString() },
    logs: logs.length,
    indexed: matched.length,
  };
}

/* ------------------------------------------------------------------------- */
/* Scan 2: curve trades for catalog tokens                                   */
/* ------------------------------------------------------------------------- */

/** Reads a cursor value from app_config, or null when there is none yet. */
async function readCursor(
  admin: ReturnType<typeof createAdminClient>,
  key: string,
): Promise<bigint | null> {
  const { data } = await admin
    .from("app_config")
    .select("value")
    .eq("key", key)
    .maybeSingle<{ value: string }>();
  return data?.value ? BigInt(data.value) : null;
}

/**
 * Trades of BegFi's own tokens.
 *
 * The CATALOG IS THE SCOPE, the same rule the explore page follows: the factory
 * is shared infrastructure and most curves on it have nothing to do with BegFi,
 * so only curves recorded in `begfi.launches` are watched. Rows missing their
 * cached `curve_address` get it backfilled from `getLaunchedToken` — a bounded
 * number per run, because a catalog that just grew by fifty rows should not
 * turn into fifty uncapped RPC calls inside a cron window.
 *
 * Both trade events decode through the curve ABI by topic: `decodeEventLog`
 * matches the signature, so a buy and a sell are distinguished by which event
 * matched, not by parsing data blindly. Volume is the quote side of each trade
 * — `quoteIn` for a buy, `quoteOut` for a sell — stored raw in wei so sums stay
 * exact no matter how they are rounded for display.
 */
async function indexTrades(
  client: ReturnType<typeof createPublicClient>,
  admin: ReturnType<typeof createAdminClient>,
  safeHead: bigint,
) {
  const { data: catalog } = await admin
    .from("launches")
    .select("token_address, curve_address")
    .limit(MAX_CATALOG);

  const rows = (catalog ?? []) as { token_address: string; curve_address: string | null }[];

  // Backfill the curve cache from the factory, bounded per run.
  const missing = rows.filter((r) => !r.curve_address).slice(0, CURVE_BACKFILL_PER_RUN);
  for (const row of missing) {
    try {
      const record = await client.readContract({
        abi: ponsFactoryAbi,
        address: PONS_FACTORY,
        functionName: "getLaunchedToken",
        args: [row.token_address as `0x${string}`],
      });
      const curve = record.curve?.toLowerCase();
      if (curve && curve !== "0x0000000000000000000000000000000000000000") {
        await admin
          .from("launches")
          .update({ curve_address: curve })
          .eq("token_address", row.token_address);
        row.curve_address = curve;
      }
    } catch {
      // The factory read failed for one token; it retries on the next run and
      // the rest of the catalog is unaffected.
    }
  }

  const curveToToken = new Map<string, string>();
  for (const row of rows) {
    if (row.curve_address) curveToToken.set(row.curve_address, row.token_address);
  }

  if (curveToToken.size === 0) {
    return { skipped: "no catalog curves to watch" };
  }

  // No cursor yet: start at the tip rather than at genesis. A first run that
  // tried to scan the whole chain would time out and record nothing, and every
  // trade before the indexer existed belongs to tokens that were not on the
  // site either.
  const from = (await readCursor(admin, TRADE_CURSOR_KEY)) ?? safeHead;

  if (from >= safeHead) {
    return { indexed: 0, note: "already at head" };
  }

  const to = from + BLOCK_WINDOW > safeHead ? safeHead : from + BLOCK_WINDOW;

  const logs = await client.getLogs({
    address: [...curveToToken.keys()] as `0x${string}`[],
    fromBlock: from + 1n,
    toBlock: to,
  });

  const tradeRows: TradeRow[] = [];
  for (const log of logs) {
    const curve = log.address.toLowerCase();
    const token = curveToToken.get(curve);
    if (!token) continue;

    let decoded;
    try {
      decoded = decodeEventLog({ abi: ponsCurveAbi, data: log.data, topics: log.topics });
    } catch {
      // An event this ABI does not know (an upgrade, a new Pons version) is
      // skipped, not guessed at.
      continue;
    }

    const { eventName, args } = decoded;
    if (eventName !== "CurveBuy" && eventName !== "CurveSell") continue;

    const isBuy = eventName === "CurveBuy";
    const a = args as {
      buyer?: string;
      seller?: string;
      quoteIn?: bigint;
      quoteOut?: bigint;
      tokensOut?: bigint;
      tokensIn?: bigint;
    };
    const trader = String(isBuy ? a.buyer : a.seller).toLowerCase();
    const quote = isBuy ? a.quoteIn! : a.quoteOut!;
    const tokens = isBuy ? a.tokensOut! : a.tokensIn!;

    tradeRows.push({
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token_address: token,
      curve_address: curve,
      trader,
      is_buy: isBuy,
      quote_amount: quote.toString(),
      token_amount: tokens.toString(),
      block_number: Number(log.blockNumber),
      block_time: "", // filled below, with the rest of the timestamps
    });
  }

  if (tradeRows.length > 0) {
    const times = await blockTimes(client, [...new Set(tradeRows.map((r) => BigInt(r.block_number)))]);
    for (const row of tradeRows) {
      row.block_time = times.get(BigInt(row.block_number).toString())!;
    }

    await admin.from("trades").upsert(tradeRows, {
      onConflict: "tx_hash,log_index",
      ignoreDuplicates: true,
    });
  }

  await admin.from("app_config").upsert(
    { key: TRADE_CURSOR_KEY, value: to.toString(), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return {
    scanned: { from: (from + 1n).toString(), to: to.toString() },
    logs: logs.length,
    indexed: tradeRows.length,
    curves: curveToToken.size,
  };
}

/** Block timestamps for a set of block numbers, deduplicated. */
async function blockTimes(
  client: ReturnType<typeof createPublicClient>,
  blockNumbers: bigint[],
): Promise<Map<string, string>> {
  const blocks = await Promise.all(
    [...new Set(blockNumbers)].map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      return [blockNumber.toString(), new Date(Number(block.timestamp) * 1000).toISOString()] as const;
    }),
  );
  return new Map(blocks);
}
