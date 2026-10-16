import "server-only";

import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { formatAmount, TOKEN_DECIMALS } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Transfer } from "@/lib/types";

/**
 * PAY LINKS — the ask and its settlement.
 *
 * A pay link is an ASK, not a balance: `pay_links` holds what someone wants and
 * what it is for. "Paid" is not a column anywhere, because BegFi is not a party
 * to the payment — the payer's wallet transfers straight to the owner's wallet
 * and the indexer records the confirmed `Transfer` event. So settlement is
 * DERIVED, here, from those confirmed rows. There is no state machine to get
 * out of step with the chain, and no row in a database of ours that could ever
 * move money.
 *
 * TWO DIFFERENT READERS, TWO DIFFERENT AMOUNTS OF TRUTH. The public page may
 * show an aggregate (how much has arrived) and whether the ask is met — the same
 * facts `received_since` already exposes for begs. It must NOT show who paid:
 * migration 0001 refuses a publicly readable `transfers` table precisely because
 * that publishes the whole sender→recipient graph. So the settling query below
 * selects the tx hash and the amount and deliberately never selects
 * `from_address`, and the page has no sender to render even by accident.
 */

export type PayLinkRow = {
  id: string;
  owner_id: string;
  token_address: string;
  chain_id: number;
  /**
   * Base units as text, or null for an open-ended ask.
   *
   * IT MUST BE SELECTED `::text` — see `exactAmount` below for what a bare
   * `numeric(78,0)` does on its way through PostgREST. This one is not a display
   * concern: the pay page feeds it back through `formatAmount` into the send
   * panel's LOCKED amount, so a truncated read is a truncated on-chain payment
   * that no longer meets the ask, and the request can never settle.
   */
  amount: string | null;
  memo: string | null;
  is_active: boolean;
  created_at: string;
  /**
   * The confirmed transfer that met this ask, recorded by the indexer at the
   * moment it indexed the transfer (migration 0027). Null means "not settled" —
   * including for links paid before that column existed, which is why the window
   * search below still exists as a fallback.
   */
  settled_tx: string | null;
  settled_amount: string | null;
  settled_at: string | null;
};

export type PayLinkView = PayLinkRow & {
  owner_wallet: string;
  owner_username: string | null;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
  /**
   * A hidden profile stays hidden: the pay page then shows the wallet and no
   * name, exactly as the public profile page 404s rather than revealing one.
   */
  owner_is_hidden: boolean;
};

export type PayLinkSettlement = {
  /** `unknown` is a failed read, which is not the same fact as `waiting`. */
  status: "paid" | "waiting" | "closed" | "unknown";
  /** Exact total credited to the owner since the link was created. */
  received_total: string | null;
  /** The confirmed transfer that met the ask, if one did. */
  settling_tx: string | null;
  settling_amount: string | null;
  settling_at: string | null;
};

/**
 * A row id, shape-checked before any query.
 *
 * Without this, `/pay/nonsense` reaches Postgres and comes back as a 22P02
 * invalid-input-syntax error — a 500 for what is plainly a 404, and a database
 * error in the logs for a URL a person mistyped.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPayLinkId(value: string): boolean {
  return UUID.test(value);
}

/**
 * One link, with the owner attached.
 *
 * The admin client is used because the page has to render for a signed-out
 * visitor AND for the owner, and it needs the owner's wallet address (which the
 * public profile policy returns anyway) together with `is_hidden` (which it does
 * not). The hidden flag is then honoured in what the page RENDERS rather than in
 * what it may read — and this function returns nothing a page is not allowed to
 * show, because a server component cannot un-fetch.
 */
export async function getPayLink(id: string): Promise<PayLinkView | null> {
  if (!SUPABASE_CONFIGURED || !isPayLinkId(id)) return null;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: link, error } = await admin
    .from("pay_links")
    .select(
      "id, owner_id, token_address, chain_id, amount::text, memo, is_active, created_at, settled_tx, settled_amount::text, settled_at",
    )
    .eq("id", id)
    .maybeSingle<PayLinkRow>();

  if (error || !link) return null;

  const { data: owner } = await admin
    .from("profiles")
    .select("wallet_address, username, display_name, avatar_url, is_hidden")
    .eq("id", link.owner_id)
    .maybeSingle<{
      wallet_address: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      is_hidden: boolean;
    }>();

  if (!owner) return null;

  return {
    ...link,
    owner_wallet: owner.wallet_address,
    owner_username: owner.is_hidden ? null : owner.username,
    owner_display_name: owner.is_hidden ? null : owner.display_name,
    owner_avatar_url: owner.is_hidden ? null : owner.avatar_url,
    owner_is_hidden: owner.is_hidden,
  };
}

/**
 * Whether this ask has been met, from confirmed transfers only.
 *
 * THE TOTAL IS AN AGGREGATE FUNCTION, NOT A SUM OF A PAGE. `received_since`
 * (migration 0007) sums in the database with definer rights, so the number stays
 * exact however many payments arrive — summing the rows a page happened to fetch
 * gives the total of *that page*, which looks right on a quiet link and is wrong
 * on a busy one. That is the same trap `profile_stats` exists to avoid.
 *
 * THE SETTLING TRANSFER IS MATCHED AGAINST THE RECENT WINDOW, and that limit is
 * stated rather than hidden: a transfer that meets the ask is found among the
 * most recent transfers to the owner for this token. A link whose ask was met
 * thousands of payments ago reads as `waiting` while the total above it still
 * shows the money — which is why the total is the number the page leads with and
 * the badge is secondary. Closing that gap properly means storing the match at
 * index time, which is Phase 1 work.
 */
/**
 * A base-unit amount as an exact decimal string, or null if it is not one.
 *
 * THE HAZARD THIS EXISTS FOR, stated once and reused: a `numeric` column crossing
 * PostgREST becomes a JSON number, and a float64 mantissa is 53 bits, so a
 * 24-digit base-unit amount arrives either rounded or as `1e+22`. `BigInt("1e+22")`
 * THROWS — which is how the pay page 500'd the first time it had a real total to
 * show — and `BigInt(9.19e23)` silently accepts a number whose last digits are
 * gone. So every money read here selects `::text` where it can, and comes through
 * this function where it cannot: exact digits, or an honest null.
 */
function exactAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value : String(value);
  // Digits only. A value carrying an exponent or a decimal point has already
  // lost the digits a money figure is made of, and guessing them back would be
  // inventing a number.
  return /^\d+$/.test(raw) ? raw : null;
}

export async function settlementFor(link: PayLinkView): Promise<PayLinkSettlement> {
  const base: PayLinkSettlement = {
    status: link.is_active ? "waiting" : "closed",
    received_total: null,
    settling_tx: null,
    settling_amount: null,
    settling_at: null,
  };

  if (!SUPABASE_CONFIGURED) return { ...base, status: "unknown" };

  // The aggregate runs as the caller: `received_since` is granted to anon, which
  // is what lets a shared link show progress to someone who never signed in.
  let total: string | null = null;
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("received_since", {
      p_wallet: link.owner_wallet,
      p_since: link.created_at,
    });
    if (!error) total = exactAmount(data);
  } catch {
    total = null;
  }

  /*
   * THE RECORDED SETTLEMENT COMES FIRST, AND IS THE ANSWER.
   *
   * The indexer decides this once, at the moment it indexes the transfer that met
   * the ask, and writes it to the row (migration 0027). Reading it is exact and
   * costs one column that was already fetched, so a link settled months ago still
   * says "Paid" and names the right transaction.
   *
   * THE WINDOW SEARCH BELOW IS A FALLBACK, for links paid BEFORE that column
   * existed — and it is a fallback with a stated limit (`KNOWN_ISSUES.md` #17):
   * it looks at the most recent 50 transfers to this wallet for this token, so a
   * very old settlement falls out of the window and the badge reads "waiting"
   * while the total above it still shows the money. Nothing new depends on it.
   */
  let settling: { tx_hash: string; amount: string | null; block_time: string | null } | null = link.settled_tx
    ? { tx_hash: link.settled_tx, amount: link.settled_amount, block_time: link.settled_at }
    : null;
  let readOk = settling !== null;

  if (!settling) {
    // Reads with the service role because the public policy on `transfers` is
    // (correctly) involved-parties-only.
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("transfers")
        .select("tx_hash, amount::text, block_time")
        .eq("to_address", link.owner_wallet.toLowerCase())
        .eq("token_address", link.token_address.toLowerCase())
        .gt("block_time", link.created_at)
        .order("block_time", { ascending: false })
        .limit(50);

      if (!error && data) {
        readOk = true;
        const rows = data as Pick<Transfer, "tx_hash" | "amount" | "block_time">[];
        const ask = link.amount === null ? null : BigInt(link.amount);
        // `amount` is read as text and parsed defensively: a row whose amount
        // cannot be parsed is skipped rather than allowed to throw and turn a
        // payment page into a 500.
        const found =
          rows.find((row) => {
            if (ask === null) return true;
            const amount = exactAmount(row.amount);
            return amount !== null && BigInt(amount) >= ask;
          }) ?? null;
        settling = found ? { tx_hash: found.tx_hash, amount: found.amount, block_time: found.block_time } : null;
      }
    } catch {
      readOk = false;
    }
  }

  if (!readOk && total === null) return { ...base, status: "unknown" };

  return {
    // Paid beats closed: a retired link whose ask was met is still a paid link,
    // and saying "closed" about it would hide the money that did arrive.
    status: settling ? "paid" : base.status,
    received_total: total,
    settling_tx: settling?.tx_hash ?? null,
    settling_amount: settling?.amount ?? null,
    settling_at: settling?.block_time ?? null,
  };
}

/* ------------------------------------------------------------------------- */
/* Settlement at detection time: the indexer's pass, and the bell           */
/* ------------------------------------------------------------------------- */

/** One confirmed transfer, exactly as the indexer recorded it. */
export type IndexedPayTransfer = {
  to_address: string;
  /** Base units as TEXT: a numeric crossing PostgREST loses its last digits. */
  amount: string;
  tx_hash: string;
  block_time: string;
};

export type PayLinkSettlementPass = {
  settled: number;
  belled: number;
  /** Set when the pass could not run at all, for the caller's log line. */
  skipped: string | null;
};

/**
 * Settle and announce, from the transfers the indexer just confirmed.
 *
 * THIS IS THE DETECTION PATH, AND IT IS THE SAME ONE THAT INDEXES TRANSFERS.
 * No second watcher, no second RPC read, no second idea of what a payment is: the
 * indexer already holds the confirmed log, so the pay-link decision is made from
 * that array while it is in hand, inside the run that wrote it down. A parallel
 * detector would be a second thing that can disagree with the ledger.
 *
 * WHAT IT DECIDES, per transfer to a wallet that owns an ACTIVE link for the token,
 * created before the transfer happened:
 *
 *   1. The largest ask the transfer COVERS → that link is settled (atomically, and
 *      the settlement is written to the row) and its owner is belled.
 *   2. Otherwise, an OPEN-ENDED link (no amount) → the owner is belled. "Any
 *      amount" is fulfilled by definition, so the bell asserts nothing it cannot
 *      prove.
 *   3. Otherwise — a PARTIAL payment toward a fixed ask — NO BELL. The money is
 *      real and the page's total shows it, but saying "you were paid toward this
 *      request" would be a guess about the payer's intent, and this product does not
 *      state what it cannot back (see the honesty rule in `PROJECT_BRAIN.md`).
 *
 * WHY THE BELL IS SAFE TO RUN TWICE. The indexer's scan is a window, and a window
 * that fails to advance is re-scanned — the same transfer array can be handed to
 * this function again. Two guards make that harmless: the settlement UPDATE claims
 * the row only while `settled_tx is null` (and reports how many rows it took, so a
 * loser does not bell), and the notification's `payload.ref` carries the link id
 * and the tx hash, so a second insert for the same pair is skipped.
 */
export async function settlePayLinks(
  admin: ReturnType<typeof createAdminClient>,
  transfers: IndexedPayTransfer[],
  options: { bellBudget?: number } = {},
): Promise<PayLinkSettlementPass> {
  const out: PayLinkSettlementPass = { settled: 0, belled: 0, skipped: null };

  if (transfers.length === 0) return out;
  if (!BEG_TOKEN_ADDRESS) {
    out.skipped = "no $BEGFI address configured";
    return out;
  }

  // A bell budget, because a run that indexes a hundred transfers must not write a
  // hundred notifications in a 60-second function. Whatever is left is picked up
  // by the next run: the transfers are already recorded, and the guard is the
  // transfer's own presence, not this counter.
  const budget = options.bellBudget ?? 25;

  const wallets = [...new Set(transfers.map((t) => t.to_address.toLowerCase()))];

  const { data: owners, error: ownerError } = await admin
    .from("profiles")
    .select("id, wallet_address")
    .in("wallet_address", wallets);

  if (ownerError) {
    out.skipped = `profile read failed: ${ownerError.message}`;
    return out;
  }
  if (!owners || owners.length === 0) return out;

  const ownerByWallet = new Map((owners as { id: string; wallet_address: string }[]).map((o) => [o.wallet_address, o.id]));

  const { data: links, error: linkError } = await admin
    .from("pay_links")
    .select("id, owner_id, amount::text, memo, created_at, settled_tx")
    .in("owner_id", [...new Set(ownerByWallet.values())])
    .eq("is_active", true)
    .eq("token_address", BEG_TOKEN_ADDRESS.toLowerCase())
    .limit(500);

  if (linkError) {
    out.skipped = `link read failed: ${linkError.message}`;
    return out;
  }
  if (!links || links.length === 0) return out;

  const linksByOwner = new Map<string, { id: string; amount: string | null; memo: string | null; created_at: string }[]>();
  for (const link of links as { id: string; owner_id: string; amount: string | null; memo: string | null; created_at: string }[]) {
    const list = linksByOwner.get(link.owner_id);
    if (list) list.push(link);
    else linksByOwner.set(link.owner_id, [link]);
  }

  // Oldest first: if a wallet owns two links and one transfer arrives, the earlier
  // request is the one it most plausibly answers, and settling in chain order keeps
  // a re-run over an overlapping window from changing its mind.
  const ordered = [...transfers].sort((a, b) => (a.block_time < b.block_time ? -1 : a.block_time > b.block_time ? 1 : 0));

  for (const transfer of ordered) {
    if (out.belled >= budget) break;

    const ownerId = ownerByWallet.get(transfer.to_address.toLowerCase());
    if (!ownerId) continue;

    const candidates = (linksByOwner.get(ownerId) ?? []).filter(
      (link) => link.created_at < transfer.block_time,
    );
    if (candidates.length === 0) continue;

    const paid = exactAmount(transfer.amount);
    if (paid === null) continue; // unparseable amount: never guess at money
    const paidUnits = BigInt(paid);

    // 1. The largest ask this transfer covers — the closest fit, not the cheapest.
    const covered = candidates
      .filter((link) => link.amount !== null && paidUnits >= BigInt(link.amount))
      .sort((a, b) => (BigInt(b.amount!) > BigInt(a.amount!) ? 1 : -1));

    // 2. Otherwise an open-ended request, which any payment answers.
    const target = covered[0] ?? candidates.find((link) => link.amount === null) ?? null;
    if (!target) continue; // a partial payment toward a fixed ask: recorded, never assumed

    if (target.amount !== null) {
      // The atomic claim: only the run that takes the row from null to a hash may
      // announce it. `settled_at` is the CHAIN's moment for the payment, not the
      // run's, because that is the time the money moved.
      const { data: claimed, error: claimError } = await admin
        .from("pay_links")
        .update({ settled_tx: transfer.tx_hash, settled_amount: paid, settled_at: transfer.block_time })
        .eq("id", target.id)
        .is("settled_tx", null)
        .select("id");

      if (claimError) continue;
      if (!claimed || claimed.length === 0) continue; // a concurrent run got there first
      out.settled += 1;
    }

    const ref = `paylink-${target.id}-${transfer.tx_hash}`;

    // Deduplicated on the ref rule this codebase uses everywhere: the same fact is
    // never written twice, so a re-scanned window re-bells nothing.
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("profile_id", ownerId)
      .eq("kind", "pay_link_paid")
      .contains("payload", { ref })
      .limit(1);
    if (existing && existing.length > 0) continue;

    const display = formatAmount(paidUnits, TOKEN_DECIMALS);
    const forWhat = target.memo ? `"${target.memo}"` : "your request";

    const { error: bellError } = await admin.from("notifications").insert({
      profile_id: ownerId,
      kind: "pay_link_paid",
      title: `${display} $BEGFI arrived`,
      body:
        target.amount !== null
          ? `${forWhat} — someone paid the full amount. The transfer is confirmed on-chain, so the money is in your wallet; BegFi never held it.`
          : `${forWhat} — someone paid. The transfer is confirmed on-chain, so the money is in your wallet; BegFi never held it.`,
      payload: { ref, tx: transfer.tx_hash, amount: paid, link_id: target.id },
      href: `/pay/${target.id}`,
    });
    if (!bellError) out.belled += 1;
  }

  return out;
}

/**
 * The signed-in owner's links, for the dashboard.
 *
 * Read through the CALLER'S session, so `pay_links_read_public` plus the
 * explicit owner filter do the work and there is no ownership check to get
 * wrong here.
 */
export async function listOwnPayLinks(ownerId: string): Promise<PayLinkRow[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const sb = await createClient();

  const { data, error } = await sb
    .from("pay_links")
    .select(
      "id, owner_id, token_address, chain_id, amount::text, memo, is_active, created_at, settled_tx, settled_amount::text, settled_at",
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return data as PayLinkRow[];
}
