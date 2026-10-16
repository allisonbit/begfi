import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { after } from "next/server";
import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { ponsCurveAbi } from "@/lib/curve";
import { ponsFactoryAbi, ponsEscrowAbi, PONS_FACTORY } from "@/lib/pons";
import { rankWeek } from "@/lib/battles";
import { settlePayLinks, type PayLinkSettlementPass } from "@/lib/pay-links";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  distributorAddress,
  shouldTriggerOnFunds,
  sweepEarnPayouts,
} from "@/lib/earn-distributor";
import {
  creditCampaignDeposits,
  shouldTriggerOnCampaignFunds,
  sweepCampaignPayouts,
} from "@/lib/campaign-distributor";
import {
  creditDropDeposits,
  shouldTriggerOnDropFunds,
  sweepDropPayouts,
} from "@/lib/drop-distributor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The indexer (spec §7.4).
 *
 * Two independent scans, one cursor each:
 *
 *  1. TRANSFERS. Reads `Transfer` events of the $BEGFI contract and records the
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
  tax_amount: string;
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
      // PUBLIC RPC FIRST, deliberately. This scan needs eth_getLogs over a
      // 2,000-block window; Alchemy's FREE tier caps getLogs at 10 blocks, so
      // preferring an Alchemy key made every run die at the first log read
      // (and a scan that never persisted a cursor kept skipping windows
      // forever). The public endpoint serves wide ranges; Alchemy remains a
      // FALLBACK for deployments where the public one is unreachable.
      process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
    ),
  });

  try {
    const head = await client.getBlockNumber();
    const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

    // The scans are independent and either may be skipped: transfers need a
    // $BEGFI address to exist at all, trades need at least one catalog row.
    const transfers = await indexTransfers(client, admin, safeHead);
    const trades = await indexTrades(client, admin, safeHead);

    // CAMPAIGN DEPOSITS: the same window, scanned for every campaign token
    // heading INTO the distributor wallet. Each credited deposit is a chain
    // fact (idempotent by tx+log); a freshly credited pool means money a
    // campaign can pay with TODAY, so a campaign sweep fires the same way
    // BegFi's own funds-arrival sweep does.
    const credited = await creditCampaignDeposits(
      admin,
      client,
      BigInt(transfers.rangeFrom ?? safeHead.toString()),
      BigInt(transfers.rangeTo ?? safeHead.toString()),
      distributorAddress(),
    );
    if (credited.tokensWithDeposits > 0) {
      const triggered = await shouldTriggerOnCampaignFunds(admin);
      if (triggered) {
        after(async () => {
          try {
            await sweepCampaignPayouts("campaign-funds-arrival");
          } catch {
            // A failed campaign sweep retries on the next cron window or the
            // next deposit; the deposits themselves are already recorded.
          }
        });
      }
    }

    // DROP DEPOSITS: the same window again, this time matched against FUNDING
    // INTENTS rather than tokens — a drop is the second product on the same
    // wallet, so a drop transfer is credited to the pot whose funder said it
    // was coming and to no other (migration 0029). A newly credited pot means a
    // giveaway can pay prizes NOW, so a drop sweep fires the way the campaign
    // one does. A transfer with no intent is credited nowhere, by design.
    const dropCredits = await creditDropDeposits(
      admin,
      client,
      BigInt(transfers.rangeFrom ?? safeHead.toString()),
      BigInt(transfers.rangeTo ?? safeHead.toString()),
      distributorAddress(),
    );
    if (dropCredits.credited > 0) {
      const triggered = await shouldTriggerOnDropFunds(admin);
      if (triggered) {
        after(async () => {
          try {
            await sweepDropPayouts("drop-funds-arrival");
          } catch {
            // A failed drop sweep retries on the next trigger; the deposit
            // itself is already recorded and the claim keeps its place.
          }
        });
      }
    }

    // THE FUNDS-ARRIVAL TRIGGER: when the just-scanned window moved $BEGFI
    // INTO the distributor wallet, the payout sweep runs after the response
    // (`after` keeps the indexer's own 60s budget intact) — the funding goes
    // to owed wallets as soon as the indexer can see it, daily cron or not.
    if (Number(transfers.toDistributor ?? 0) > 0) {
      const triggered = await shouldTriggerOnFunds(admin);
      if (triggered) {
        after(async () => {
          try {
            await sweepEarnPayouts("funds-arrival");
          } catch {
            // A failed trigger sweep is retried by the next cron window or
            // the next top-up; nothing needs surfacing to the caller.
          }
        });
      }
    }

    // Alerts fire AFTER the scans, from what they recorded — never from a
    // claim the scans did not back up.
    const alerts = await raiseNotifications(admin);

    // The daily digest runs on the same sweep: once per profile per UTC day,
    // summarising the same confirmed rows the scans just wrote.
    const digests = await raiseDailyDigest(admin);

    // Freeze last week's Beg Battle Top-3, once, the first run after the
    // Monday boundary.
    const battles = await freezeLastWeekBattle(admin);

    return NextResponse.json({ ok: true, transfers, trades, dropCredits, alerts, digests, battles });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Cursors are deliberately NOT advanced on failure, so the next run
    // retries the same window rather than skipping it.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ------------------------------------------------------------------------- */
/* Notifications, raised from the scans' own rows                            */
/* ------------------------------------------------------------------------- */

/**
 * The bell's rows, all of them written here, none by the client.
 *
 * Sources, in order of what the chain can prove:
 *  - begs received: transfer rows for profile wallets newer than the profile's
 *    last "beg" notification (an anti-spam watermark, not "all transfers" —
 *    re-running over an old window must not re-bell old news);
 *  - launch confirmed: catalog rows whose launch notification has not been
 *    written;
 *  - fees claimable: threshold crossing. The contract decides the amount, the
 *    tax rows decide the "worth checking" hint — one alert per crossing, and
 *    only when the escrow balance plausibly holds something. Claiming remains
 *    manual; the notification says "ready", not "done";
 *  - watchlist alerts: graduation (a watched token left the curve) and a move
 *    >= ALERT_MOVE_PCT inside the last 24h, gated by each row's own toggles.
 *
 * The ref-key rule: each notification carries payload.ref, and a duplicate
 * write is skipped when a row with the same (profile, kind, ref) already
 * exists — which is what makes a re-run of an old window re-bell nothing.
 */
const ALERT_MOVE_PCT = 25;

async function raiseNotifications(admin: ReturnType<typeof createAdminClient>) {
  // Wallets to think about: everyone with a profile, small on a young product.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, wallet_address")
    .limit(2000);

  const walletToProfile = new Map(
    (profiles ?? []).map((p: { wallet_address: string; id: string }) => [p.wallet_address, p]),
  );

  let created = 0;

  const push = async (
    profileId: string,
    kind: string,
    title: string,
    body: string,
    ref: string,
    href: string | null,
  ) => {
    // Deduplicate on (profile, kind, ref). The index is not unique (jsonb in a
    // unique index is awkward across drivers), so check-then-insert is the
    // rule; the cron is the only writer, so races do not exist by construction.
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("profile_id", profileId)
      .eq("kind", kind)
      .contains("payload", { ref })
      .limit(1);
    if (existing && existing.length > 0) return;

    const { error } = await admin.from("notifications").insert({
      profile_id: profileId,
      kind,
      title,
      body,
      payload: { ref },
      href,
    });
    if (!error) created += 1;
  };

  // --- begs received: recent transfers to profile wallets -------------------
  if (BEG_TOKEN_ADDRESS) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("transfers")
      .select("from_address, to_address, amount::text, tx_hash, block_time")
      .eq("token_address", BEG_TOKEN_ADDRESS)
      .gte("block_time", since)
      .order("block_time", { ascending: false })
      .limit(500);

    for (const t of recent ?? []) {
      const profile = walletToProfile.get(t.to_address);
      if (!profile) continue;
      await push(
        profile.id,
        "beg",
        "You received $BEGFI",
        `${t.amount.slice(0, 12)}... base units from ${t.from_address.slice(0, 6)}...${t.from_address.slice(-4)}.`,
        t.tx_hash,
        "/dashboard/activity",
      );
    }
  }

  // --- launch confirmed: launches whose notification has not been written ---
  const { data: freshLaunches } = await admin
    .from("launches")
    .select("token_address, name, ticker, launcher_wallet, tx_hash")
    .order("created_at", { ascending: false })
    .limit(100);

  for (const l of freshLaunches ?? []) {
    const profile = walletToProfile.get(l.launcher_wallet);
    if (!profile) continue;
    await push(
      profile.id,
      "launch",
      `${l.name} is live on BegFi`,
      `The launch confirmed on-chain.`,
      l.tx_hash,
      `/token/${l.token_address}`,
    );
  }

  // --- fees claimable & watched tokens: need live escrow + curve reads ------
  // Bounded: the escrow read is one call per profile with launches, and the
  // move check is one reserves read per watched token.
  const { data: launchers } = await admin
    .from("launches")
    .select("launcher_wallet, token_address, name, ticker")
    .order("created_at", { ascending: false })
    .limit(500);

  const escrowClient = createPublicClient({ chain: robinhoodChain, transport: http() });
  let escrowAddress: string | null = null;
  try {
    escrowAddress = (await escrowClient.readContract({
      abi: ponsFactoryAbi,
      address: PONS_FACTORY,
      functionName: "feeEscrow",
    })) as unknown as string;
  } catch {
    escrowAddress = null;
  }

  if (escrowAddress) {
    const byLauncher = new Map<string, string[]>();
    for (const l of launchers ?? []) {
      const list = byLauncher.get(l.launcher_wallet);
      if (list) list.push(l.token_address);
      else byLauncher.set(l.launcher_wallet, [l.token_address]);
    }

    for (const [wallet] of byLauncher) {
      const profile = walletToProfile.get(wallet);
      if (!profile) continue;
      try {
        const claimable = (await escrowClient.readContract({
          abi: ponsEscrowAbi,
          address: escrowAddress as `0x${string}`,
          functionName: "balanceOf",
          args: [wallet as `0x${string}`],
        })) as unknown as bigint;

        if (claimable > 10n ** 15n) {
          await push(
            profile.id,
            "fees",
            "Fees are ready to claim",
            "Your escrow balance is above 0.001 ETH. Claiming is manual, from the Fees tab.",
            `fees-claimable`,
            "/dashboard/fees",
          );
        }
      } catch {
        /* the escrow read failed for this wallet; skip, no invention */
      }
    }
  }

  // --- watchlist graduation + big moves -----------------------------------
  const { data: watchRows } = await admin
    .from("watchlist")
    .select("profile_id, token_address, alert_on_move, alert_on_graduation")
    .limit(2000);

  // Token graduation states and 24h price change, from the same sources the
  // public pages use.
  const tokenMeta = new Map<string, { phase: number; curve: string }>();
  for (const l of launchers ?? []) {
    try {
      const record = await escrowClient.readContract({
        abi: ponsFactoryAbi,
        address: PONS_FACTORY,
        functionName: "getLaunchedToken",
        args: [l.token_address as `0x${string}`],
      });
      tokenMeta.set(l.token_address, { phase: Number(record.phase), curve: String(record.curve) });
    } catch {
      /* unreadable tokens contribute nothing */
    }
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const w of watchRows ?? []) {
    const meta = tokenMeta.get(w.token_address);
    if (!meta) continue;

    if (w.alert_on_graduation && meta.phase !== 0) {
      const launchName = (launchers ?? []).find((l) => l.token_address === w.token_address);
      await push(
        w.profile_id,
        "graduation",
        `A watched token graduated`,
        `${launchName ? `${launchName.name} ($${launchName.ticker})` : "A token you watch"} left the curve and trades on the pool.`,
        `grad-${w.token_address}`,
        `/token/${w.token_address}`,
      );
    }

    if (w.alert_on_move) {
      const { data: dayTrades } = await admin
        .from("trades")
        .select("quote_amount, token_amount")
        .eq("token_address", w.token_address)
        .gte("block_time", dayAgo)
        .order("block_time", { ascending: true })
        .limit(10_000);

      const priced = (dayTrades ?? [])
        .filter((t) => t.token_amount !== "0" && t.quote_amount !== "0")
        .map((t) => Number(BigInt(t.quote_amount)) / Number(BigInt(t.token_amount)));

      if (priced.length >= 2) {
        const change = (priced[priced.length - 1] / priced[0] - 1) * 100;
        if (Math.abs(change) >= ALERT_MOVE_PCT) {
          const launchName = (launchers ?? []).find((l) => l.token_address === w.token_address);
          await push(
            w.profile_id,
            "move",
            `A watched token moved ${change > 0 ? "+" : ""}${Math.round(change)}%`,
            `${
              launchName
                ? `${launchName.name} ($${launchName.ticker}) moved past the alert threshold in 24h.`
                : "A token you watch moved past the alert threshold in 24h."
            }`,
            `move-${w.token_address}-${Math.round(Math.abs(change) / ALERT_MOVE_PCT)}`, // re-alerts on each further 25% step
            `/token/${w.token_address}`,
          );
        }
      }
    }
  }

  return { created };
}

/* ------------------------------------------------------------------------- */
/* Weekly Beg Battle: freeze last week's Top-3                                */
/* ------------------------------------------------------------------------- */

/**
 * The battle ranking is computed fresh per request from confirmed
 * transfers, but the BADGE has to outlive the week: a profile checks
 * "am I a Top Beggar?" against a frozen record, not against a live
 * window that has since reset. So the first run after a Monday 00:00 UTC
 * boundary writes the now-closed week's Top-3 into begfi.battle_winners
 * — once, keyed by the week's Monday date; a re-run never rewrites it.
 */
async function freezeLastWeekBattle(admin: ReturnType<typeof createAdminClient>) {
  const now = new Date();
  // Monday 00:00 UTC of the week containing now.
  const thisWeek = (() => {
    const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
    return utc.toISOString().slice(0, 10);
  })();
  const d = new Date(`${thisWeek}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  const lastWeek = d.toISOString().slice(0, 10);

  // Already frozen? Then there is nothing to do — idempotency by key.
  const { data: existing } = await admin
    .from("battle_winners")
    .select("week_start")
    .eq("week_start", lastWeek)
    .maybeSingle<{ week_start: string }>();
  if (existing) return { frozen: false, week: lastWeek };

  const since = `${lastWeek}T00:00:00Z`;
  const until = `${thisWeek}T00:00:00Z`;

  const { data: rows, error } = await admin
    .from("transfers")
    .select("to_address, from_address, amount::text")
    .gte("block_time", since)
    .lt("block_time", until)
    .limit(20_000);
  if (error) return { frozen: false, error: error.message };

  // ONE RANKING, TWO CONSUMERS. The page shows this week live with the same
  // aggregate `rankWeek` computes — anti-wash exclusions included — so the
  // crown cannot disagree with the board by running on a second rulebook.
  const ranked = rankWeek((rows ?? []) as { to_address: string; from_address: string; amount: string }[]);

  // Names for the top wallets only. A wallet with no visible profile is
  // skipped, not renamed.
  const top = [...ranked.entries()]
    .sort((a, b) => (a[1].received > b[1].received ? -1 : a[1].received < b[1].received ? 1 : 0))
    .slice(0, 12)
    .map(([wallet, stats]) => [wallet, stats.received] as const);
  const winners = [];
  if (top.length > 0) {
    const wallets = top.map(([w]) => w);
    const { data: profiles } = await admin
      .from("profiles")
      .select("username, wallet_address")
      .in("wallet_address", wallets)
      .eq("is_hidden", false)
      .limit(3);
    const nameByWallet = new Map(
      ((profiles ?? []) as { username: string; wallet_address: string }[]).map((p) => [
        p.wallet_address.toLowerCase(),
        p.username,
      ]),
    );
    for (const [wallet, amount] of top) {
      const username = nameByWallet.get(wallet);
      if (username) winners.push({ username, wallet, received: amount.toString() });
      if (winners.length >= 3) break;
    }
  }

  const { error: insertError } = await admin
    .from("battle_winners")
    .upsert({ week_start: lastWeek, winners, frozen_at: new Date().toISOString() });
  if (insertError) return { frozen: false, error: insertError.message };

  return { frozen: true, week: lastWeek, winners: winners.length };
}

/* ------------------------------------------------------------------------- */
/* The daily digest: once per profile per UTC day                            */
/* ------------------------------------------------------------------------- */

/**
 * One notification per profile per day, telling them what the chain says
 * happened to them in the previous 24h: begs received ($BEGFI amount and
 * count), fee-bearing trades on their launches (sum of recorded taxes), and
 * launches recorded. Every figure is summed from the rows this cron itself
 * maintains, so the digest cannot say anything the scans did not record.
 *
 * THE REF IS THE DATE (UTC). That is what enforces "once per day" without a
 * separate watermark: a re-run during the same UTC day deduplicates against
 * itself, and the next day's ref is a different key. The digest is skipped
 * entirely for profiles whose 24h was empty — a notification that says
 * "nothing happened" every day is a mute button in training.
 */
async function raiseDailyDigest(admin: ReturnType<typeof createAdminClient>) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let created = 0;

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username")
    .limit(2000);

  for (const profile of profiles ?? []) {
    created += await digestForProfile(admin, profile.id, profile.username, dayKey, since);
  }

  return { created };
}

/** One profile's digest from confirmed rows; returns 1 when written. */
async function digestForProfile(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  username: string,
  dayKey: string,
  since: string,
): Promise<number> {
  const { data: profileRow } = await admin
    .from("profiles")
    .select("wallet_address")
    .eq("id", profileId)
    .maybeSingle<{ wallet_address: string }>();
  if (!profileRow) return 0;

  const wallet = profileRow.wallet_address.toLowerCase();

  const [transfers, tradesOut, launchesOut] = await Promise.all([
    admin
      .from("transfers")
      .select("amount::text")
      .eq("to_address", wallet)
      .gte("block_time", since)
      .limit(10_000),
    admin
      .from("launches")
      .select("token_address, name, ticker")
      .eq("launcher_wallet", wallet)
      .limit(100),
    admin
      .from("launches")
      .select("token_address", { count: "exact" })
      .eq("launcher_wallet", wallet)
      .gte("created_at", since)
      .limit(0),
  ]);

  const tokens = (tradesOut.data ?? []).map((r: { token_address: string }) => r.token_address as string);

  let begTotal = 0n;
  let begCount = 0;
  for (const t of transfers.data ?? []) {
    begTotal += BigInt((t as { amount: string }).amount);
    begCount += 1;
  }

  let taxTotal = 0n;
  if (tokens.length > 0) {
    const { data: dayTrades } = await admin
      .from("trades")
      .select("tax_amount")
      .in("token_address", tokens)
      .gte("block_time", since)
      .limit(20_000);
    for (const t of dayTrades ?? []) taxTotal += BigInt(t.tax_amount ?? "0");
  }

  const newLaunches = launchesOut.count ?? 0;

  if (begCount === 0 && taxTotal === 0n && newLaunches === 0) return 0;

  const parts: string[] = [];
  if (begCount > 0) parts.push(`${begCount} $BEGFI ${begCount === 1 ? "send" : "sends"} to you`);
  if (taxTotal > 0n) parts.push(`creator taxes on your tokens`);
  if (newLaunches > 0) parts.push(`${newLaunches} ${newLaunches === 1 ? "launch" : "launches"} recorded`);

  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("profile_id", profileId)
    .eq("kind", "digest")
    .contains("payload", { ref: dayKey })
    .limit(1);
  if (existing && existing.length > 0) return 0;

  const { error } = await admin.from("notifications").insert({
    profile_id: profileId,
    kind: "digest",
    title: `Your 24h, ${username}`,
    body: `${parts.join(`, `)}. Confirmed on-chain, from your wallet's actual rows.`,
    payload: { ref: dayKey, begs: begCount, fees: taxTotal.toString(), launches: newLaunches },
    href: "/dashboard/activity",
  });

  return error ? 0 : 1;
}

/* ------------------------------------------------------------------------- */
/* Scan 1: $BEGFI transfers to registered wallets                              */
/* ------------------------------------------------------------------------- */

async function indexTransfers(
  client: ReturnType<typeof createPublicClient>,
  admin: ReturnType<typeof createAdminClient>,
  safeHead: bigint,
) {
  let payLinkSettlements: PayLinkSettlementPass = { settled: 0, belled: 0, skipped: null };
  if (!BEG_TOKEN_ADDRESS) {
    // Expected until $BEGFI is actually launched. Not an error: there is nothing
    // to index, and saying so is more useful than a stack trace.
    return { skipped: "no $BEGFI token address configured" };
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

  /*
   * A PAY LINK PUTS ITS OWNER ON THE WATCH LIST, HIDDEN OR NOT.
   *
   * Transfers are indexed for visible profiles only — the rule that stops this
   * scan recording every wallet on the chain. But a payment request is an
   * EXPLICIT ASK: someone who creates `/pay/<id>` and shares it has asked to be
   * paid, and a private account's request would otherwise never settle, because
   * the very transfer that answers it would not be indexed. The ask is the
   * consent that the hidden-profile rule was protecting.
   *
   * Indexing the row is not publishing it: `transfers` stays involved-parties-only
   * under RLS, and the public surfaces (the pay page's total, the profile total)
   * reach it only through the definer aggregates that return a number.
   */
  const { data: askingLinks } = await admin
    .from("pay_links")
    .select("profiles!inner(wallet_address)")
    .eq("is_active", true)
    .limit(2000);

  for (const row of (askingLinks ?? []) as { profiles: { wallet_address: string } | { wallet_address: string }[] }[]) {
    const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (owner?.wallet_address) watched.add(owner.wallet_address.toLowerCase());
  }

  const matched = logs.filter((log) => {
    const to = log.args.to?.toLowerCase();
    return Boolean(to && watched.has(to));
  });

  // FUNDS-ARRIVAL DETECTION. The distributor wallet is not a registered user
  // wallet, so its transfers never match `watched` — a top-up the admin sends
  // would be invisible to everything else. Count the transferred TO the
  // distributor in this scan window: that count is what the daily run sees to
  // fire the payout sweep, the second trigger besides the cron itself.
  let toDistributor = 0;
  const distributor = distributorAddress();
  if (distributor) {
    try {
      const funded = await client.getLogs({
        address: BEG_TOKEN_ADDRESS as `0x${string}`,
        event: TRANSFER_EVENT,
        args: { to: distributor as `0x${string}` },
        fromBlock: from + 1n,
        toBlock: to,
      });
      toDistributor = funded.length;
    } catch {
      // A failed top-up probe costs at most a day of distribution delay; the
      // cron trigger is unaffected and is the fallback path by design.
    }
  }

  if (matched.length > 0) {
    // Timestamps come from the block, not from now(): the time a transfer
    // happened is a property of the chain, and `on conflict do nothing` makes
    // a re-run over an overlapping window idempotent.
    const times = await blockTimes(client, matched.map((l) => l.blockNumber!));

    const transferRows = matched.map((log) => ({
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token_address: BEG_TOKEN_ADDRESS,
      from_address: log.args.from!.toLowerCase(),
      to_address: log.args.to!.toLowerCase(),
      amount: log.args.value!.toString(),
      block_number: Number(log.blockNumber),
      block_time: times.get(log.blockNumber!.toString())!,
    }));

    await admin.from("transfers").upsert(transferRows, {
      onConflict: "tx_hash,log_index",
      ignoreDuplicates: true,
    });

    /*
     * THE PAY-LINK PASS, from the rows that were just written. This is the SAME
     * detection path — one confirmed transfer, decided once, by the run that
     * recorded it; there is no second watcher looking for payments, because two
     * detectors are two things that can disagree. It settles the request whose ask
     * the transfer met and bells its owner (see `settlePayLinks`).
     */
    payLinkSettlements = await settlePayLinks(admin, transferRows);
  }

  await admin.from("app_config").upsert(
    { key: TRANSFER_CURSOR_KEY, value: to.toString(), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  // THE SITE'S TOKEN, KEPT IN STEP WITH THE CODE.
  //
  // `beg_token_address` is what `received_since` and `profile_stats` filter on,
  // so it decides every "how much has arrived" number on the site (beg progress,
  // the beg OG card, a profile's received total, a pay link's received total).
  // It is seeded empty in migration 0001 for a pre-launch site and NOTHING used
  // to write it — so after $BEGFI launched it still read `''`, and every one of
  // those numbers was silently 0 (see migration 0026).
  //
  // Written here, on every run, from `BEG_TOKEN_ADDRESS` — the same pinned
  // constant the transfer scan above stores on each row it indexes. That makes
  // the aggregate filter and the rows it filters impossible to disagree, which is
  // the whole point: a config row that only a human remembers to update is a
  // config row that will be wrong again.
  if (BEG_TOKEN_ADDRESS) {
    await admin.from("app_config").upsert(
      { key: "beg_token_address", value: BEG_TOKEN_ADDRESS, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  }

  return {
    scanned: { from: (from + 1n).toString(), to: to.toString() },
    logs: logs.length,
    indexed: matched.length,
    toDistributor,
    // Requests settled and owners belled from the transfers in this window: the
    // report says what the pass did rather than leaving it to be inferred from
    // notification rows later.
    payLinks: payLinkSettlements,
    // The exact window this scan covered, for the campaign-deposit scan that
    // walks the same blocks (strings keep the JSON shape; BigInt re-parses).
    rangeFrom: from.toString(),
    rangeTo: to.toString(),
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
      fee?: bigint;
      tax?: bigint;
    };
    const trader = String(isBuy ? a.buyer : a.seller).toLowerCase();
    const quote = isBuy ? a.quoteIn! : a.quoteOut!;
    const tokens = isBuy ? a.tokensOut! : a.tokensIn!;
    // The creator tax side of the trade, recorded per row since 0010. It is
    // the tax the curve event reports — the amount the creator's share grew
    // by on this trade — and it is what the Fees tab's history chart is
    // summed from. The curve fee (a.?fee, protocol side) is deliberately NOT
    // recorded here: it is not the creator's.
    const tax = a.tax ?? 0n;

    tradeRows.push({
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token_address: token,
      curve_address: curve,
      trader,
      is_buy: isBuy,
      quote_amount: quote.toString(),
      token_amount: tokens.toString(),
      tax_amount: tax.toString(),
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
