import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, http } from "viem";
import { robinhoodChain, shortAddress } from "@/lib/chains";
import { erc20Abi } from "@/lib/erc20";
import { ageWords, compactAmount } from "@/lib/format";
import { TOKEN_DECIMALS } from "@/lib/erc20";
import { formatEth, ponsCurveAbi, pricePerToken } from "@/lib/curve";
import { LAUNCH_CONFIG_ID, PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Launch } from "@/lib/types";

export const metadata: Metadata = {
  title: "Explore",
  description: "Tokens launched through BegFi on Robinhood Chain.",
};

/** Re-read every couple of minutes rather than on every request. */
export const revalidate = 120;

/**
 * Tokens launched from BegFi.
 *
 * THE CATALOG IS THE DATABASE, NOT THE FACTORY. Pons' factory is shared —
 * anyone on the chain can call it, and scanning its events would fill this
 * page with tokens that have nothing to do with BegFi while wearing its name.
 * A token appears here only if `/api/launch` recorded it, and it only recorded
 * it after proving, on-chain, that the launcher's own wallet signed it.
 *
 * Status and numbers still come from the chain, live: `getLaunchedToken` says
 * whether the curve has graduated; curve reserves set price and market cap. A
 * read that fails is left blank rather than guessed.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

type Listed = Launch & {
  graduated: boolean | null;
  /** Live curve numbers; null when graduated, unreadable, or still unknown. */
  curve: { price: string; pooled: string; mc: string } | null;
  /** Market cap as a plain number for sorting; 0 when unknown. */
  mcNum: number;
  /** Pooled ETH as raw wei while on curve, so totals can be summed exactly. */
  pooledWei: bigint | null;
  /** Fraction of the graduation threshold the pooled ETH reaches, 0..1. */
  progress: number | null;
};

const SORTS = ["mc", "newest", "oldest"] as const;
type Sort = (typeof SORTS)[number];

function parseSort(value: string | undefined): Sort {
  return SORTS.includes(value as Sort) ? (value as Sort) : "mc";
}

function sortLabel(sort: Sort): string {
  if (sort === "mc") return "Market cap";
  if (sort === "oldest") return "Oldest";
  return "Newest";
}

/** Full row fetch, capped: the catalog is small; 60 covers the first screens. */
async function recentLaunches(limit = 60): Promise<{ items: Listed[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("launches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { items: [], dbFailed: true };

  /*
   * getReserves() reports the curve's virtual quote reserve: real ETH plus the
   * config's phantomQuote that sets the opening price. The pooled figure
   * subtracts it, so a card shows ETH traders actually put in. If this config
   * read fails the curve numbers are left out entirely rather than computed
   * against a guessed phantom.
   */
  let phantom: bigint | null = null;
  try {
    const config = await client.readContract({
      abi: ponsFactoryAbi,
      address: PONS_FACTORY,
      functionName: "getLaunchConfig",
      args: [LAUNCH_CONFIG_ID],
    });
    phantom = config[2];
  } catch {
    phantom = null;
  }

  const items = await Promise.all(
    data.map(async (launch) => {
      try {
        const record = await client.readContract({
          abi: ponsFactoryAbi,
          address: PONS_FACTORY,
          functionName: "getLaunchedToken",
          args: [launch.token_address as `0x${string}`],
        });

        // Curve numbers only while the token is still on its curve: after
        // graduation the reserves are swept to the pair pool, and a curve
        // price would describe a market the token no longer trades on.
        if (record.phase !== 0 || phantom === null) {
          return { ...launch, graduated: record.phase !== 0, curve: null, mcNum: 0, pooledWei: null, progress: null };
        }

        try {
          const [reserves, supply] = await Promise.all([
            client.readContract({
              abi: ponsCurveAbi,
              address: record.curve,
              functionName: "getReserves",
            }),
            client.readContract({
              abi: erc20Abi,
              address: launch.token_address as `0x${string}`,
              functionName: "totalSupply",
            }),
          ]);
          const [quoteReserve, tokenReserve] = reserves;
          const pooled = quoteReserve > phantom ? quoteReserve - phantom : 0n;

          /*
           * Market cap: supply x curve price, the same definition odys uses
           * while a token is pre-graduation. Computed with float math on a
           * value nobody trades on directly; the price string above keeps the
           * exact figure for anyone who wants it.
           */
          const priceNum = Number(quoteReserve) / Number(tokenReserve);
          const supplyNum = Number(supply) / 10 ** Number(TOKEN_DECIMALS);
          const mc = Number.isFinite(priceNum) && tokenReserve > 0n ? priceNum * supplyNum : 0;

          const progress =
            record.graduationThreshold > 0n
              ? Number((pooled * 10_000n) / record.graduationThreshold) / 10_000
              : null;

          return {
            ...launch,
            graduated: false,
            curve: {
              price: pricePerToken(quoteReserve, tokenReserve),
              pooled: formatEth(pooled),
              mc: compactAmount(mc),
            },
            mcNum: mc,
            pooledWei: pooled,
            progress,
          };
        } catch {
          // The curve read failed; the status stays, the numbers stay out.
          return { ...launch, graduated: false, curve: null, mcNum: 0, pooledWei: null, progress: null };
        }
      } catch {
        // The token is in the catalog; its live status is just unreadable.
        return { ...launch, graduated: null, curve: null, mcNum: 0, pooledWei: null, progress: null };
      }
    }),
  );

  return { items, dbFailed: false };
}

/**
 * Launch analytics bar. Every number here is computed from the same real
 * sources as the list — the catalog table and live curve reads. Trading volume
 * and fee revenue are NOT shown because nothing indexes trade events yet; a
 * panel that displays zeros it invented would be worse than one that admits
 * the gap.
 */
async function launchStats(items: Listed[]) {
  // The total comes from the whole table, not just the rows the page lists; if
  // this count fails the visible rows are still a real count.
  let totalLaunches = items.length;
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("launches")
      .select("*", { count: "exact", head: true });
    if (!error && count !== null) totalLaunches = count;
  } catch {
    /* service key unavailable; the listed count is still real */
  }
  const graduated = items.filter((i) => i.graduated === true).length;
  const pooledWei = items.reduce((sum, i) => (i.pooledWei ? sum + i.pooledWei : sum), 0n);

  const top = items.reduce<Listed | null>(
    (best, i) => (i.pooledWei && (!best?.pooledWei || i.pooledWei > best.pooledWei) ? i : best),
    null,
  );

  // 14 daily buckets, oldest first, UTC — the day a launch was recorded is a
  // property of the row, not of when this page renders.
  const days: { label: string; key: string; count: number; isToday: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    days.push({
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      key: d.toISOString().slice(0, 10),
      count: 0,
      isToday: i === 0,
    });
  }
  const keyToIndex = new Map(days.map((day, idx) => [day.key, idx]));
  for (const item of items) {
    const idx = keyToIndex.get(item.created_at.slice(0, 10));
    if (idx !== undefined) days[idx].count += 1;
  }

  return { totalLaunches, graduated, pooledWei, top, days };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam);

  const { items, dbFailed } = await recentLaunches();
  const stats = await launchStats(items);

  /*
   * Ranking. "Market cap" is supply x live curve reserves — a real ranking of
   * real numbers, not a JSON price. Tokens whose curve could not be read keep
   * launch-date order and follow the ranked ones, never lost between chips.
   */
  const byDate = (a: Listed, b: Listed) =>
    b.created_at.localeCompare(a.created_at);
  const sorted = [...items].sort((a, b) => {
    const aKnown = a.curve !== null;
    const bKnown = b.curve !== null;
    if (sort === "newest") return byDate(a, b);
    if (sort === "oldest") return byDate(b, a);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (!aKnown || !bKnown) return byDate(a, b);
    if (b.mcNum !== a.mcNum) return b.mcNum - a.mcNum;
    return byDate(a, b);
  });

  // Chart's tallest bar is the scale; a day with no launches renders as a dot.
  const maxCount = Math.max(1, ...stats.days.map((d) => d.count));

  const chip = (active: boolean) =>
    `rounded-full border-2 border-beg-ink px-3 py-1.5 text-[12px] font-bold ${
      active ? "bg-beg-lime text-beg-ink" : "bg-beg-card"
    }`;

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Explore</h1>
          <p className="mt-1 text-beg-dim">Launched on BegFi, ranked live from the curve.</p>
        </div>
        <Link href="/launch" className="btn-primary">
          Launch a token
        </Link>
      </header>

      {/*
       * Launch analytics. "Top token" is by pooled ETH right now — the one
       * number that is provably on-chain. A 24h volume leader needs a
       * trade-event indexer, which does not exist yet; when it does, this is
       * the slot it fills.
       */}
      <section className="card p-5 max-md:rotate-[0.4deg] md:rotate-[-0.5deg]">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-[22px] font-extrabold tracking-[-.03em]">Launch analytics</h2>
          <span className="rounded-full border-2 border-beg-ink bg-beg-yellow px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em]">
            Live from the chain
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border-2 border-beg-ink bg-beg-bg p-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[.09em] text-beg-dim">Launches</dt>
            <dd className="mt-1 text-[30px] font-extrabold leading-none tracking-[-.03em]">{stats.totalLaunches}</dd>
          </div>
          <div className="rounded-2xl border-2 border-beg-ink bg-beg-bg p-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[.09em] text-beg-dim">Graduated</dt>
            <dd className="mt-1 text-[30px] font-extrabold leading-none tracking-[-.03em]">{stats.graduated}</dd>
          </div>
          <div className="rounded-2xl border-2 border-beg-ink bg-beg-bg p-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[.09em] text-beg-dim">ETH on curves</dt>
            <dd className="mt-1 text-[30px] font-extrabold leading-none tracking-[-.03em]">{formatEth(stats.pooledWei)}</dd>
          </div>
          <div className="rounded-2xl border-2 border-beg-ink bg-beg-bg p-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[.09em] text-beg-dim">Top token</dt>
            <dd className="mt-1 truncate text-[30px] font-extrabold leading-none tracking-[-.03em]">
              {stats.top ? (
                <Link href={`/token/${stats.top.token_address}`} className="bg-beg-lime px-1 text-beg-ink hover:underline">
                  ${stats.top.ticker}
                </Link>
              ) : (
                <span className="text-[18px] leading-none text-beg-dim">None yet</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-2xl border-2 border-beg-ink bg-beg-bg p-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <b className="text-[14px]">Launches per day</b>
            <span className="text-[11px] text-beg-dim">last 14 days</span>
          </div>
          <div className="flex h-[88px] items-end gap-1.5">
            {stats.days.map((day) => (
              <div
                key={day.key}
                title={`${day.label}: ${day.count} launch${day.count === 1 ? "" : "es"}`}
                className="flex-1"
              >
                <div
                  className={`w-full rounded-t-[4px] border-2 border-beg-ink border-b-0 transition-[height] duration-500 ${
                    day.isToday ? "bg-beg-blue" : "bg-beg-lime"
                  } ${day.count === 0 ? "h-[6px] opacity-40" : ""}`}
                  style={day.count === 0 ? undefined : { height: `${Math.max(8, (day.count / maxCount) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-beg-dim">
            <span>{stats.days[0]?.label}</span>
            <span>today</span>
          </div>
        </div>
      </section>

      {/* Sort row: real sortings, not decorative ones. "24h/7d" and volume
          windows arrive with the trade indexer; showing disabled chips that
          filter nothing would be a lie on a page about numbers. */}
      <nav aria-label="Sort tokens" className="flex flex-wrap items-center gap-2">
        <Link
          href="/explore"
          aria-current={sort === "mc" ? "page" : undefined}
          className={`${chip(sort === "mc")} rotate-[-0.5deg]`}
        >
          Market cap
        </Link>
        <Link
          href="/explore?sort=newest"
          aria-current={sort === "newest" ? "page" : undefined}
          className={`${chip(sort === "newest")} rotate-[0.6deg]`}
        >
          Newest
        </Link>
        <Link
          href="/explore?sort=oldest"
          aria-current={sort === "oldest" ? "page" : undefined}
          className={`${chip(sort === "oldest")} rotate-[-0.8deg]`}
        >
          Oldest
        </Link>
      </nav>

      {dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read the launch catalog just now. That&apos;s a problem reaching the
          database, not an empty list. Try again in a moment.
        </p>
      ) : items.length === 0 ? (
        <p className="notice p-5">
          Nothing has launched on BegFi yet. The first one will appear here the moment it is
          confirmed.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sorted.map((item) => (
            <li key={item.token_address}>
              <Link href={`/token/${item.token_address}`} className="card-hover card flex gap-3">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="size-14 shrink-0 rounded-xl border-2 border-beg-ink object-cover"
                  />
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-xl border-2 border-beg-ink bg-beg-lime text-xl font-extrabold text-beg-ink">
                    {item.name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="truncate text-[18px] text-beg-ink">{item.name}</b>
                    <span className="shrink-0 rounded-full border-2 border-beg-ink bg-beg-bg px-2 py-0.5 text-[10px] font-bold">
                      {ageWords(item.created_at)} old
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-beg-dim">
                    by {shortAddress(item.launcher_wallet)}, ${item.ticker}
                  </p>
                  {item.curve ? (
                    <>
                      <p className="mt-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-[22px] font-extrabold tracking-[-.02em]">{item.curve.mc}</span>
                        <span className="shrink-0 text-[11px] text-beg-dim">market cap</span>
                      </p>
                      {/* Progress toward graduation when the threshold is
                          readable; the bar is honest about "unknown" by not
                          rendering at all. */}
                      {item.progress !== null ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="progress h-2 flex-1">
                            <div
                              className="progress-fill"
                              style={{ width: `${Math.min(100, Math.max(2, item.progress * 100))}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-bold">{Math.round(item.progress * 100)}%</span>
                        </div>
                      ) : null}
                      <p className="mt-1.5 flex items-center justify-between text-[12px] text-beg-dim">
                        <span>{item.graduated === false ? "On the curve" : "Graduated"}</span>
                        <span>{item.curve.pooled} ETH pooled</span>
                      </p>
                    </>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-beg-dim">
                      {item.graduated === true ? "Graduated" : item.graduated === null ? "" : "On the curve"}
                      {item.graduated === null ? "Status unavailable" : ""}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Trading volume and 24h rankings are to come: BegFi does not index
          trade events yet, and this page shows real numbers or nothing. */}
      <p className="notice">
        Volume stats and 24h rankings arrive with the trade indexer. Every number here now is
        read live from Robinhood Chain.
      </p>

      {/*
        Spec §12: the disclaimer belongs wherever strangers' tokens are listed.
        Everything here launched from BegFi — and none of it is endorsed.
      */}
      <p className="notice">
        Every token here launched through BegFi, on Pons&apos; contracts. BegFi does not vet any of
        them; listing is not an endorsement, a review, or advice. Check a contract before you trade
        it.
      </p>
    </div>
  );
}
