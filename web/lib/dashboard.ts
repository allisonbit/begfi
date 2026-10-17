import "server-only";

import { createPublicClient, http, parseAbiItem } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { formatEth, ponsCurveAbi, pricePerToken } from "@/lib/curve";
import { TOKEN_DECIMALS, formatAmount } from "@/lib/erc20";
import { LAUNCH_CONFIG_ID, PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { getApprovedUnclaimed } from "@/lib/earn";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Server reads for the tabbed dashboard.
 *
 * Everything here follows the same rule as the rest of the product: the chain
 * and the indexer's tables are the only facts. No number in these functions is
 * synthesized — a read that fails is returned as null and the tab says what it
 * does not know rather than showing a placeholder.
 */
const client = createPublicClient({ chain: robinhoodChain, transport: http() });

const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);

/**
 * How far back the launcher scan reaches, in blocks. The catalog
 * (`begfi.launches`) is the primary source and carries no window; this scan
 * only supplements it so a launch whose catalog write failed still shows with
 * what the chain can prove. The public RPC refuses unbounded ranges, so the
 * window is fixed.
 */
const WINDOW = 200_000n;

/** Catalog rows per dashboard render, capped like the explore page. */
const MAX_LAUNCHES = 60;

export type DashLaunch = {
  token_address: string;
  name: string;
  ticker: string;
  image_url: string | null;
  created_at: string;
  tx_hash: string | null;
  /** Creator tax in basis points, straight from the factory record. */
  taxBps: number | null;
  graduated: boolean | null;
  /** Curve price in ETH for display; null when graduated or unreadable. */
  price: string | null;
  /** ETH traders actually put in, while on the curve. */
  pooledEth: string | null;
  pooledWei: string | null;
  /** Graduation threshold in ETH for display. */
  thresholdEth: string | null;
  /** Market cap as a compact display string. */
  mc: string | null;
  /** 24h quote volume in ETH (indexer confirmed trades). */
  volume24hEth: string | null;
  /** Distinct traders in the last 24h. */
  traders24h: number | null;
  /** Fraction of the graduation threshold reached (0..1). */
  progress: number | null;
};

export type FeedItem = {
  kind: "beg" | "trade" | "launch";
  at: string;
  tx: string | null;
  text: string;
  /** The sender's note, when one was attached to this transfer. */
  message?: string | null;
  /** The recipient's hide flag, shown only so their own view can mark it. */
  messageHidden?: boolean;
};

export type OwnBeg = {
  id: string;
  body: string;
  goal: string | null;
  created_at: string;
};

/**
 * Tokens the wallet launched, joined with live curve numbers and 24h trade
 * aggregates. The catalog row decides the list (it is what the token pages
 * serve); the chain decides every number shown about it, exactly as explore
 * and the token page do.
 */
export async function getLauncherDashboard(wallet: string): Promise<{
  launches: DashLaunch[];
  dbFailed: boolean;
}> {
  if (!SUPABASE_CONFIGURED) return { launches: [], dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { launches: [], dbFailed: true };
  }

  const { data: catalog, error } = await admin
    .from("launches")
    .select("*")
    .eq("launcher_wallet", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(MAX_LAUNCHES + 20);

  if (error || !catalog) return { launches: [], dbFailed: true };
  if (catalog.length === 0) return { launches: [], dbFailed: false };

  /*
   * The one launch config the factory exposes carries the supply and the
   * graduation threshold, which every MC and progress figure is built from.
   * A failed read takes the numbers out with it, not invents a default.
   */
  let supply = 1_000_000_000n;
  let phantom: bigint | null = null;
  let threshold: bigint | null = null;
  try {
    const config = await client.readContract({
      abi: ponsFactoryAbi,
      address: PONS_FACTORY,
      functionName: "getLaunchConfig",
      args: [LAUNCH_CONFIG_ID],
    });
    supply = config[0];
    phantom = config[2];
    threshold = config[3];
  } catch {
    phantom = null;
    threshold = null;
  }

  const addresses = catalog.map((l) => l.token_address as `0x${string}`).slice(0, MAX_LAUNCHES);

  const reads = await Promise.all(
    addresses.map(async (token) => {
      try {
        const record = await client.readContract({
          abi: ponsFactoryAbi,
          address: PONS_FACTORY,
          functionName: "getLaunchedToken",
          args: [token],
        });
        return { token, record };
      } catch {
        return { token, record: null };
      }
    }),
  );

  const curveReads = await Promise.all(
    reads.map(async ({ token, record }) => {
      if (!record || record.phase !== 0 || phantom === null) {
        return { token, price: null as string | null, pooledWei: null as string | null };
      }
      try {
        const reserves = await client.readContract({
          abi: ponsCurveAbi,
          address: record.curve,
          functionName: "getReserves",
        });
        const [quoteReserve, tokenReserve] = reserves;
        const price = pricePerToken(quoteReserve, tokenReserve);
        const pooled = quoteReserve > phantom ? quoteReserve - phantom : 0n;
        return { token, price, pooledWei: pooled.toString() };
      } catch {
        return { token, price: null as string | null, pooledWei: null as string | null };
      }
    }),
  );

  const tokensLower = addresses.map((t) => t.toLowerCase());

  /*
   * Trade aggregates come from the indexer's confirmed trades. Traders24h is a
   * distinct count over the same window; holders are not indexed (transfers of
   * individual catalog tokens are not recorded), so cards show traders — a
   * figure that exists — rather than a holder count that would have to be
   * pretended.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [volume, tradeRows] = await Promise.all([
    admin
      .from("trades")
      .select("token_address, quote_amount")
      .in("token_address", tokensLower)
      .gte("block_time", since)
      .limit(20_000),
    admin
      .from("trades")
      .select("token_address, trader")
      .in("token_address", tokensLower)
      .gte("block_time", since)
      .limit(20_000),
  ]);

  const volumeBy = new Map<string, string>();
  if (volume.data) {
    for (const row of volume.data) {
      const key = row.token_address.toLowerCase();
      volumeBy.set(key, ((BigInt(volumeBy.get(key) ?? "0")) + BigInt(row.quote_amount)).toString());
    }
  }
  const tradersBy = new Map<string, number>();
  if (tradeRows.data) {
    for (const row of tradeRows.data) {
      const key = row.token_address.toLowerCase();
      tradersBy.set(key, (tradersBy.get(key) ?? 0) + 1);
    }
  }

  const launches: DashLaunch[] = catalog.slice(0, MAX_LAUNCHES).map((row) => {
    const token = row.token_address.toLowerCase();
    const matched = reads.find((r) => r.token.toLowerCase() === token);
    const curve = curveReads.find((r) => r.token.toLowerCase() === token);
    const record = matched?.record ?? null;
    const pooledWeiStr = curve?.pooledWei ?? null;

    let mc: string | null = null;
    let progress: number | null = null;

    return {
      token_address: token,
      name: row.name,
      ticker: row.ticker,
      image_url: row.image_url,
      created_at: row.created_at,
      tx_hash: row.tx_hash,
      taxBps: record ? Number(record.creatorTaxBps) : null,
      graduated: record ? record.phase !== 0 : null,
      price: curve?.price ?? null,
      pooledEth: pooledWeiStr ? formatEth(BigInt(pooledWeiStr)) : null,
      pooledWei: pooledWeiStr,
      thresholdEth: threshold !== null ? formatEth(threshold) : null,
      mc: null,
      volume24hEth: volumeBy.has(token) ? formatEth(BigInt(volumeBy.get(token)!)) : null,
      traders24h: tradersBy.has(token) ? tradersBy.get(token)! : null,
      progress:
        pooledWeiStr && threshold !== null && threshold > 0n
          ? Math.max(0, Math.min(1, Number(BigInt(pooledWeiStr)) / Number(threshold)))
          : null,
    };
  });

  /*
   * Market cap, computed here where the supply is known. Price carries 18
   * decimals as a string; a double rounds digits nobody reads on a sticker,
   * and MC is a read, never a traded number, so Number math is allowed here
   * like it is on the explore page.
   */
  for (const l of launches) {
    if (l.price && l.price !== "n/a" && l.price !== "<0.000000001") {
      const p = Number(l.price);
      if (Number.isFinite(p) && p > 0) {
        const mcNum = p * Number(supply);
        if (Number.isFinite(mcNum)) l.mc = compact(mcNum);
      }
    }
  }

  return { launches, dbFailed: false };
}

function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (x: number) => {
    const rounded = Math.abs(x) >= 100 ? Math.round(x) : Number(x.toFixed(1));
    return (rounded === 0 ? 0 : rounded).toString();
  };
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}

/**
 * The unified activity feed: begs received, personal trades, launches.
 *
 * One merged list because a day on BegFi is all three of those things. Fee
 * claims are deliberately absent: the escrow does not expose a claimed-amount
 * getter in the ABI BegFi reads, and the indexer does not record claim events,
 * so the only honest claim entry is the success message shown at claim time.
 * Trades use the wallet's own address as the trader filter — the feed at /token
 * pages needs nothing here.
 */
export async function getActivityFeed(wallet: string, limit = 100): Promise<{
  items: FeedItem[];
  dbFailed: boolean;
}> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { items: [], dbFailed: true };
  }
  const w = wallet.toLowerCase();

  const [transfers, trades, launches] = await Promise.all([
    admin
      .from("transfers")
      .select("tx_hash, from_address, amount, block_time, transfer_messages(message, hidden_by_recipient)")
      .eq("to_address", w)
      .order("block_time", { ascending: false })
      .limit(limit),
    admin
      .from("trades")
      .select("tx_hash, token_address, is_buy, quote_amount, token_amount, block_time")
      .eq("trader", w)
      .order("block_time", { ascending: false })
      .limit(limit),
    admin
      .from("launches")
      .select("token_address, name, ticker, tx_hash, created_at")
      .eq("launcher_wallet", w)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const failed = Boolean(transfers.error && trades.error && launches.error);

  const items: FeedItem[] = [];

  for (const t of transfers.data ?? []) {
    // type shape: transfer_messages is an array (to-one embed) or null
    const msg = Array.isArray(t.transfer_messages) ? t.transfer_messages[0] : null;
    const note = msg?.message ? ` — “${msg.message}”` : "";
    items.push({
      kind: "beg",
      at: t.block_time,
      tx: t.tx_hash,
      text: `Received ${formatAmount(BigInt(t.amount))} $BEGFI from ${t.from_address.slice(0, 6)}…${t.from_address.slice(-4)}${note}`,
      message: msg?.message ?? null,
      messageHidden: msg?.hidden_by_recipient ?? false,
    });
  }

  for (const t of trades.data ?? []) {
    const label = t.is_buy ? "Bought" : "Sold";
    items.push({
      kind: "trade",
      at: t.block_time,
      tx: t.tx_hash,
      text: `${label} on ${t.token_address.slice(0, 6)}…${t.token_address.slice(-4)} for ${formatEth(BigInt(t.quote_amount))} ETH`,
    });
  }

  for (const l of launches.data ?? []) {
    items.push({
      kind: "launch",
      at: l.created_at,
      tx: l.tx_hash,
      text: `Launched ${l.name} ($${l.ticker})`,
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));

  return { items: items.slice(0, limit), dbFailed: failed };
}

/**
 * The signed-in user's own begs, with their goals, for the Begs tab.
 */
export async function getOwnBegs(username: string, limit = 20): Promise<{
  begs: OwnBeg[];
  dbFailed: boolean;
}> {
  if (!SUPABASE_CONFIGURED) return { begs: [], dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { begs: [], dbFailed: true };
  }

  const { data, error } = await admin
    .from("begs")
    .select("id, body, goal, created_at, profiles!inner(username)")
    .eq("profiles.username", username)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { begs: [], dbFailed: true };

  return { begs: data as unknown as OwnBeg[], dbFailed: false };
}

/**
 * Overview aggregates the client components cannot read themselves.
 *
 * THE LAUNCH METER IS GONE FROM THIS PATH, deliberately. This function used to
 * read the factory config and then two RPC calls per launched token — up to
 * five hundred of them — on every dashboard load, to compute a meter the
 * Overview never rendered. The launchpad was removed months ago; carrying its
 * arithmetic here made the first screen after sign-in wait on a product that no
 * longer exists. Two indexed reads are what the page actually shows.
 */
export async function getOverview(wallet: string): Promise<{
  supporters: number;
  totalReceived: string;
  dbFailed: boolean;
}> {
  if (!SUPABASE_CONFIGURED) return { supporters: 0, totalReceived: "0", dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { supporters: 0, totalReceived: "0", dbFailed: true };
  }
  const w = wallet.toLowerCase();

  const [received, supporters] = await Promise.all([
    admin.from("transfers").select("amount").eq("to_address", w).limit(10_000),
    admin.from("transfers").select("from_address").eq("to_address", w).limit(10_000),
  ]);

  let totalReceived = 0n;
  for (const row of received.data ?? []) totalReceived += BigInt(row.amount);

  const supporterSet = new Set<string>();
  for (const row of supporters.data ?? []) supporterSet.add(row.from_address.toLowerCase());

  return {
    supporters: supporterSet.size,
    totalReceived: totalReceived.toString(),
    dbFailed: Boolean(received.error || supporters.error),
  };
}

export type OverviewPayout = {
  amount: string;
  token_symbol: string;
  token_decimals: number;
  campaign_name: string | null;
  campaign_slug: string | null;
  at: string;
};

export type OverviewExtras = {
  /** Approved, unpaid $BEGFI from the original pool — the one manual claim. */
  claimable: string;
  payoutCount: number;
  payouts: OverviewPayout[];
  /** $BEGFI received per UTC day for the last seven days, oldest first. */
  days: { date: string; amount: string }[];
  dbFailed: boolean;
};

/**
 * The Overview's second read: what was earned, what can still be claimed, and
 * the last seven days of receipts.
 *
 * ONE FAILURE DOES NOT EMPTY THE PAGE. Each part is read independently and a
 * failure marks `dbFailed` while the other parts still render — the same rule
 * the money pages follow, where one dark stat is one dark stat. Claimable comes
 * from `earn_submissions` (the legacy pool's manual claim); campaign and drop
 * payouts are automatic and already carry a transaction, so they are shown as
 * history rather than as something to press.
 */
export async function getOverviewExtras(profileId: string, wallet: string): Promise<OverviewExtras> {
  const empty: OverviewExtras = { claimable: "0", payoutCount: 0, payouts: [], days: [], dbFailed: true };
  if (!SUPABASE_CONFIGURED) return empty;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return empty;
  }
  const w = wallet.toLowerCase();
  const since = new Date(Date.now() - 7 * 24 * 3600_000);

  const [unclaimed, payouts, payoutCount, receipts] = await Promise.all([
    getApprovedUnclaimed(profileId).catch(() => ({ ids: [] as string[], total: 0n })),
    admin
      .from("earn_payouts")
      .select("amount::text, created_at, campaign_id, token_address, campaigns(name, slug, token_symbol, token_decimals)")
      .eq("wallet_address", w)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("earn_payouts")
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", w)
      .eq("status", "sent"),
    admin
      .from("transfers")
      .select("amount, block_time")
      .eq("to_address", w)
      .gte("block_time", since.toISOString())
      .limit(20_000),
  ]);

  const byDay = new Map<string, bigint>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    byDay.set(d, 0n);
  }
  for (const row of (receipts.data ?? []) as { amount: string; block_time: string }[]) {
    const day = row.block_time.slice(0, 10);
    if (!byDay.has(day)) continue;
    byDay.set(day, (byDay.get(day) ?? 0n) + BigInt(row.amount));
  }

  const payoutRows = (payouts.data ?? []) as unknown as {
    amount: string;
    created_at: string;
    campaign_id: string | null;
    campaigns: { name: string; slug: string; token_symbol: string; token_decimals: number }[] | null;
  }[];

  return {
    claimable: unclaimed.total.toString(),
    payoutCount: payoutCount.count ?? 0,
    payouts: payoutRows.map((row) => {
      const c = row.campaigns?.[0];
      return {
        amount: row.amount,
        token_symbol: c?.token_symbol ?? "BEGFI",
        token_decimals: c?.token_decimals ?? 18,
        campaign_name: c?.name ?? null,
        campaign_slug: c?.slug ?? null,
        at: row.created_at,
      };
    }),
    days: [...byDay.entries()].map(([date, amount]) => ({ date, amount: amount.toString() })),
    dbFailed: Boolean(payouts.error || receipts.error),
  };
}

export { TOKEN_DECIMALS, formatAmount };
export const FACTORY_WINDOW = WINDOW;
export const FACTORY_EVENT = tokenLaunched;
