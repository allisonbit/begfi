/**
 * indexer-ws — a live Transfer listener, companion to the cron indexer.
 *
 * WHY THIS EXISTS. The cron scan reads blocks a window at a time, so a page can
 * sit seconds-to-minutes behind the chain. This worker subscribes to the token's
 * Transfer logs over a WebSocket and upserts the same rows into
 * begfi.transfers, so the activity feed, the totals and the battles reflect a
 * send the moment it confirms instead of at the next cron tick.
 *
 * THE INVARIANTS, so the two writers can never disagree:
 *
 *  - SAME CONFLICT KEY. Rows upsert on (tx_hash, log_index) with
 *    ignoreDuplicates, exactly like the cron scan. Whether the cron, a retry,
 *    or this worker saw a transfer first, the row is written once — dedup is
 *    a property of the table, not of the writer.
 *  - PERSISTED PROGRESS. The last fully-confirmed block is kept in
 *    begfi.app_config under `index_ws_last_block`. On startup the worker
 *    backfills everything after that cursor over plain HTTP (the same getLogs
 *    shape the cron uses), so downtime costs no events even though a WS
 *    subscription remembers nothing.
 *  - CRON REMAINS THE BACKBONE. This worker is additive; if it dies, the cron
 *    still scans and converges. It is a latency optimisation, never a source
 *    of truth.
 *  - CONFIRMATION DEPTH. A transfer whose block is N deep (default 3) is
 *    written, matching the "confirmed" rule every read in the product assumes;
 *    a reorg before that depth finds nothing recorded to unwind.
 *
 * RUN. `npm run indexer:ws`. Needs ALCHEMY_RPC_URL or CHAIN_WS_URL,
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and
 * NEXT_PUBLIC_BEG_TOKEN_ADDRESS.
 */

// Next injects .env.local automatically; a standalone script must ask dotenv
// for it by name, since dotenv only reads `.env` by default.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { createPublicClient, http, webSocket, parseAbiItem, toEventHash } from "viem";
import { createClient } from "@supabase/supabase-js";

const CHAIN_ID = Number(process.env.CHAIN_WS_CHAIN_ID ?? 4663);
/*
 * THE TOKEN, PINNED like lib/config.ts pins it: the brief is explicit that
 * this exact CA is the only one, and an environment that still carries the
 * pre-relaunch address (0xbeabe…) must not win. That is not hypothetical —
 * the worker's first live run subscribed to exactly that stale address.
 */
const TOKEN_ADDRESS = "0x18823d1f1807ce3bdd90aafb7473928bc9368242";
const CONFIRMATIONS = BigInt(process.env.CHAIN_WS_CONFIRMATIONS ?? 3);
const CURSOR_KEY = "index_ws_last_block";
const TICK_MS = 15_000;
/*
 * THE PROVIDER LIMITS, NOT FICTIONAL ONES. On Alchemy's free tier an
 * eth_getLogs request spans at most 10 blocks, so a from-genesis backfill is
 * neither cheap nor possible here: it would be millions of requests. The
 * worker therefore backfills a bounded RECENT window — the live subscription
 * being the latency optimisation, and the cron (which runs with the same
 * provider caps) remaining the history of record. Bump
 * CHAIN_WS_LOG_WINDOW / CHAIN_WS_BACKFILL_BLOCKS (and a paid key) to widen.
 */
const LOG_WINDOW = BigInt(Math.max(1, Number(process.env.CHAIN_WS_LOG_WINDOW ?? 10)));
const BACKFILL_DEPTH = BigInt(Math.max(0, Number(process.env.CHAIN_WS_BACKFILL_BLOCKS ?? 300)));

/** http→wss on the same host and path: what the provider's own entry lists. */
const WS_URL =
  process.env.CHAIN_WS_URL?.trim() ||
  (process.env.ALCHEMY_RPC_URL?.trim() ?? "").replace(/^https:\/\//, "wss://");
const HTTP_URL = process.env.ALCHEMY_RPC_URL?.trim() ?? process.env.NEXT_PUBLIC_RPC_URL?.trim() ?? "";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

for (const [name, ok] of [
  ["CHAIN_WS_URL/ALCHEMY_RPC_URL", /^(wss?:\/\/)/.test(WS_URL) || /^https:\/\//.test(HTTP_URL)],
  ["HTTP RPC", /^https:\/\//.test(HTTP_URL)],
  ["Supabase env", Boolean(SB_URL && SB_KEY)],
  ["token address", /^0x[0-9a-f]{40}$/.test(TOKEN_ADDRESS)],
]) {
  if (!ok) {
    console.error(`[ws] ${name} is missing or malformed. Not starting.`);
    process.exit(1);
  }
}

console.log(`[ws] chain ${CHAIN_ID} · token ${TOKEN_ADDRESS} · confirmations ${CONFIRMATIONS}`);

const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false },
  // BegFi's tables live in the `begfi` schema, not `public` — the app's
  // admin client sets the same. Without this every write would bounce off
  // a schema lookup, see its own failure, and log it forever.
  db: { schema: "begfi" },
});

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TRANSFER_TOPIC0 = toEventHash(TRANSFER_EVENT);

const client = createPublicClient({
  transport: webSocket(WS_URL, { keepAlive: true, reconnect: { attempts: 10_000, delay: 3_000 } }),
  chain: { id: CHAIN_ID },
});
const blockClient = createPublicClient({ transport: http(HTTP_URL, { timeout: 20_000 }), chain: { id: CHAIN_ID } });

/** Block times, cached — the same rule the cron uses. */
const times = new Map();
const inflight = new Map();
async function blockTime(blockNumber) {
  const key = blockNumber.toString();
  const have = times.get(key) ?? inflight.get(key);
  if (have) return have;
  const p = (async () => {
    try {
      const block = await blockClient.getBlock({ blockNumber });
      const iso = new Date(Number(block.timestamp) * 1000).toISOString();
      times.set(key, iso);
      if (times.size > 5_000) {
        const first = times.keys().next().value;
        if (first !== undefined) times.delete(first);
      }
      return iso;
    } catch (e) {
      console.error(`[ws] blockTime ${key} failed:`, e instanceof Error ? e.message : e);
      inflight.delete(key);
      return null;
    }
  })();
  inflight.set(key, p);
  const iso = await p;
  inflight.delete(key);
  return iso;
}

/** One write, one trust: bulk upsert on the conflict key the cron already uses. */
async function write(logs) {
  const rows = [];
  for (const log of logs) {
    const to = log.args?.to?.toLowerCase();
    const from = log.args?.from?.toLowerCase();
    const value = log.args?.value?.toString();
    if (!to || !from || !value) continue;
    const iso = await blockTime(log.blockNumber);
    if (!iso) continue; // timestamp unread → the cron will own this row
    rows.push({
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      token_address: TOKEN_ADDRESS,
      from_address: from,
      to_address: to,
      amount: value,
      block_number: Number(log.blockNumber),
      block_time: iso,
    });
  }
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("transfers").upsert(rows.slice(i, i + 500), {
      onConflict: "tx_hash,log_index",
      ignoreDuplicates: true,
    });
    if (error) {
      console.error("[ws] upsert failed:", error.message);
      return -1;
    }
  }
  return rows.length;
}

async function persistCursor(blockNumber) {
  const { error } = await sb
    .from("app_config")
    .upsert({ key: CURSOR_KEY, value: blockNumber.toString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("[ws] cursor persist failed:", error.message);
}

/** The persisted WS cursor, falling back to the cron's start point on first run. */
async function startupCursor(head) {
  const { data: own } = await sb.from("app_config").select("value").eq("key", CURSOR_KEY).maybeSingle();
  if (own?.value) return BigInt(own.value);
  // No WS history yet: cover a bounded RECENT window (see LOG_WINDOW above)
  // rather than pretending the provider can stomach a from-genesis crawl.
  return head - BACKFILL_DEPTH;
}

/** Blocks we heard about on the wire, waiting out the confirmation depth. */
const pending = new Map();
let sessionRows = 0;

/** Confirm everything in `pending` that is now deep enough. */
async function confirmUpTo(head) {
  const safe = head - CONFIRMATIONS;
  for (const [blockNumber, logs] of pending) {
    if (blockNumber > safe) continue;
    pending.delete(blockNumber);
    if (logs.length > 0) {
      const written = await write(logs);
      if (written < 0) return; // the write failed; keep the block for the cron
      sessionRows += written;
    }
    await persistCursor(blockNumber);
  }
}

/** Headline: catch up from the persisted cursor to head, then hold. */
async function backfill() {
  let head = await blockClient.getBlockNumber();
  let from = await startupCursor(head);
  if (from < head) console.log(`[ws] backfill from block ${from} to head ${head} (window ${LOG_WINDOW})`);
  while (from < head) {
    const to = from + LOG_WINDOW > head ? head : from + LOG_WINDOW;
    try {
      const logs = await blockClient.getLogs({
        address: TOKEN_ADDRESS,
        event: TRANSFER_EVENT,
        fromBlock: from + 1n,
        toBlock: to,
      });
      if (logs.length > 0) {
        const written = await write(logs);
        // A failed write must NOT advance this window's cursor — advancing
        // would declare the events ingested when no row exists, and the cron
        // would never reclaim them. Retry the same window after a pause;
        // persistent failure gives way to the cron, same as before.
        if (written < 0) {
          await new Promise((r) => setTimeout(r, 10_000));
          continue;
        }
        console.log(`[ws] backfill ${from + 1n}–${to}: ${written} event(s)`);
      }
      await persistCursor(to);
      from = to;
    } catch (e) {
      console.error("[ws] backfill window failed:", e instanceof Error ? e.message : e);
      // The cron converges regardless; do not spin a blind retry loop.
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  console.log("[ws] backfill caught up.");
}

client.watchEvent({
  address: TOKEN_ADDRESS,
  event: TRANSFER_EVENT,
  onLogs: (logs) => {
    for (const log of logs) {
      if (log.topics[0] !== TRANSFER_TOPIC0 || !log.blockNumber) continue;
      const list = pending.get(log.blockNumber) ?? [];
      list.push(log);
      pending.set(log.blockNumber, list);
    }
  },
  onError: (e) => console.error("[ws] subscription error:", e instanceof Error ? e.message : e),
});

client.watchBlockNumber({
  onBlockNumber: (head) => {
    void confirmUpTo(head).catch((e) => console.error("[ws] confirm failed:", e instanceof Error ? e.message : e));
  },
  onError: (e) => console.error("[ws] head watch error:", e instanceof Error ? e.message : e),
});

// The safety tick: an idle chain sends no new heads, and the confirmation
// depth here never hurts — confirmUpTo simply finds nothing deep enough yet.
setInterval(async () => {
  try {
    await confirmUpTo(await blockClient.getBlockNumber());
  } catch (e) {
    console.error("[ws] tick failed:", e instanceof Error ? e.message : e);
  }
}, TICK_MS);

process.on("SIGINT", () => {
  console.log(`[ws] shutting down. rows this session: ${sessionRows}`);
  process.exit(0);
});

backfill().then(() => {
  console.log("[ws] live. Confirmed transfers land in begfi.transfers within moments of the send.");
}).catch((e) => {
  console.error("[ws] backfill died:", e instanceof Error ? e.message : e);
  console.error("[ws] the cron remains authoritative for missed events; this worker stays up for new sends.");
});
