import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createPublicClient, http, isAddress } from "viem";
import { BuyPanel } from "@/components/buy-panel";
import { HoldersList } from "@/components/holders-list";
import { TokenChart } from "@/components/token-chart";
import { TokenSocials } from "@/components/token-socials";
import { addressUrl, robinhoodChain, shortAddress } from "@/lib/chains";
import { getChart, type ChartWindow } from "@/lib/chart-data";
import { formatEth, ponsCurveAbi, pricePerToken } from "@/lib/curve";
import { erc20Abi } from "@/lib/erc20";
import { getTopHolders } from "@/lib/holders";
import { getEthUsd, usdPriceLabel, usdCompactLabel } from "@/lib/eth-price";
import { LAUNCH_CONFIG_ID, PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { compactAmount } from "@/lib/format";
import { formatAmount } from "@/lib/erc20";
import type { Launch } from "@/lib/types";

type Params = { address: string };

export const dynamic = "force-dynamic";

/**
 * A token launched from BegFi.
 *
 * THIS PAGE SERVES BEGFI'S LAUNCHPAD, NOT THE FACTORY. Pons' factory is shared
 * infrastructure — anyone on Robinhood Chain can call it, and most of what it
 * produces has nothing to do with this site. So membership of `begfi.launches`
 * decides whether this page renders at all: a token recorded here was signed
 * by the launcher's own wallet through BegFi's own form, verified by
 * `/api/launch` against the receipt before the row was written.
 *
 * The chain is still the source of truth for everything the page *says* — the
 * record only gates the door. `getLaunchedToken(token)` carries the curve, the
 * tax and the phase as they are right now, and the metadata reads use the same
 * public client, so a stale row cannot show a wrong number; it can only show
 * the token at all.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

async function getLaunchUncached(token: string) {
  if (!SUPABASE_CONFIGURED) return null;

  /*
   * Membership is read from `launches` with the admin client: this is a
   * server-side read with no visitor session to inherit. The outcome is
   * three-valued on purpose, because "unreachable" and "absent" want
   * different treatment — and the safe reading of "unreachable" is refusal,
   * not trust: a failed read must never quietly render a token whose
   * membership could not be proven.
   */
  let launch: Launch | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("launches")
      .select("*")
      .eq("token_address", token.toLowerCase())
      .maybeSingle<Launch>();

    if (error) return null;
    launch = data;
  } catch {
    return null;
  }

  // No row in the catalog: the factory may have produced this token, but it
  // did not launch from BegFi, and this page does not serve the factory.
  if (!launch) return null;

  const results = await Promise.all([
    client.readContract({
      abi: ponsFactoryAbi,
      address: PONS_FACTORY,
      functionName: "getLaunchedToken",
      args: [token as `0x${string}`],
    }),
    client.readContract({
      abi: erc20Abi,
      address: token as `0x${string}`,
      functionName: "name",
    }),
    client.readContract({
      abi: erc20Abi,
      address: token as `0x${string}`,
      functionName: "symbol",
    }),
    client.readContract({
      abi: erc20Abi,
      address: token as `0x${string}`,
      functionName: "totalSupply",
    }),
  ]).catch(() => null);

  // A recorded token the chain no longer confirms — or a read that failed — is
  // refused rather than rendered from the row alone.
  if (!results) return null;
  const [record, name, symbol, totalSupply] = results;
  if (!record.exists) return null;

  /*
   * The live curve numbers. Read only while the token is still on its curve:
   * after graduation the reserves are swept to the pair pool, and a price
   * quoted against a swept curve would describe a market the token no longer
   * trades on. A failed read leaves the numbers out rather than guessed.
   */
  let curve: { price: string; pooled: string } | null = null;
  if (record.phase === 0) {
    try {
      const [reserves, config] = await Promise.all([
        client.readContract({
          abi: ponsCurveAbi,
          address: record.curve,
          functionName: "getReserves",
        }),
        client.readContract({
          abi: ponsFactoryAbi,
          address: PONS_FACTORY,
          functionName: "getLaunchConfig",
          args: [LAUNCH_CONFIG_ID],
        }),
      ]);
      const [quoteReserve, tokenReserve] = reserves;
      const phantom = config[2];
      /*
       * getReserves() reports the curve's virtual quote reserve: the real ETH
       * plus the config's phantomQuote that sets the opening price. The pooled
       * figure subtracts it, so the number is ETH traders actually put in.
       */
      curve = {
        price: pricePerToken(quoteReserve, tokenReserve),
        pooled: formatEth(quoteReserve > phantom ? quoteReserve - phantom : 0n),
      };
    } catch {
      curve = null;
    }
  }

  return { launch, record, name, symbol, totalSupply, curve };
}

/** One set of chain reads per request: the metadata and the page share this. */
const getLaunch = cache(getLaunchUncached);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: "Not found" };

  const found = await getLaunch(address);
  if (!found) return { title: "Token not found" };

  return {
    title: `${found.name} ($${found.symbol})`,
    description: `${found.name}, launched on BegFi. Fixed supply, trading on Robinhood Chain.`,
  };
}

export default async function TokenPage({ params }: { params: Promise<Params> }) {
  const { address } = await params;

  if (!isAddress(address)) notFound();

  const found = await getLaunch(address);
  if (!found) notFound();

  const { launch, record, name, symbol, curve, totalSupply } = found;

  /*
   * The holders leaderboard, computed from the token's own event history.
   * Positioned after the buy panel and the facts list, before the warning: it
   * is a figure like any other on this page, so it renders with the same
   * honesty rules — a scan that fails leaves the section out rather than
   * inventing a list.
   */
  let holders: Awaited<ReturnType<typeof getTopHolders>> | null = null;
  try {
    holders = await getTopHolders(
      record.token,
      record.curve,
      totalSupply,
      record.creatorFeeRecipient,
    );
  } catch {
    holders = null;
  }

  /*
   * The chart windows, from the indexer's confirmed trades. One read per
   * window per render — three pooled queries, each bounded like explore.
   * A window with no trades serves an empty series and the chart says so;
   * nothing is interpolated between buckets.
   */
  const chartData = await (async () => {
    const windows: ChartWindow[] = ["24h", "7d", "30d"];
    const out = {} as Record<ChartWindow, Awaited<ReturnType<typeof getChart>>>;
    for (const w of windows) {
      out[w] = await getChart(record.token, w);
    }
    return out;
  })();

  /*
   * Price for the big readout and the latest line: the chart's last close
   * when trades exist, otherwise the live curve quote. Both are ETH per
   * token; the difference is "confirmed by a trade" vs "confirmed by the
   * reserves", and the chart prefers the trade since it is what people
   * actually transacted at.
   */
  const lastTradePrice = chartData["24h"].candles.at(-1)?.c ?? null;
  const priceNum = curve && curve.price !== "n/a" && curve.price !== "<0.000000001"
    ? Number(curve.price)
    : null;
  const displayPrice = lastTradePrice ?? priceNum;

  /*
   * ETH/USD, server-fetched with a 60s shared cache. The one currency
   * conversion on the page: price and MC both derive from the same ETH-per-
   * token figure times this single rate, so they can never disagree. A null
   * feed (source down, throttled) keeps the ETH labels — the fallback is a
   * currency choice, not a hidden lie or a NaN leak.
   */
  const ethUsd = await getEthUsd();
  const priceUsd = displayPrice !== null && Number.isFinite(displayPrice) && ethUsd !== null
    ? displayPrice * ethUsd
    : null;

  /*
   * The strip's price label. Sub-nano USD prices die in generic formatters
   * (exponent notation shipped here once already), so the rules in
   * usdPriceLabel handle < $1 by spelling out decimals; the ETH fallback
   * keeps its old spelled-out path.
   */
  const ethPriceLabel = (() => {
    if (displayPrice === null || !Number.isFinite(displayPrice)) return "—";
    if (displayPrice > 0 && displayPrice < 0.000001) {
      return `${displayPrice.toFixed(12).replace(/0+$/, "")} Ξ`;
    }
    return `${displayPrice.toPrecision(4)} Ξ`;
  })();
  const priceLabel = priceUsd !== null ? usdPriceLabel(priceUsd) : ethPriceLabel;
  const mc = priceUsd !== null
    ? usdCompactLabel(priceUsd * (Number(totalSupply) / 1e18))
    : displayPrice !== null && Number.isFinite(displayPrice)
      ? compactAmount(displayPrice * (Number(totalSupply) / 1e18))
      : null;

  /*
   * Supply reads, not shouts: 1,000,000,000 formatted with the shared 18-dec
   * formatter, compacted for the strip. Raw BigInt-to-Number conversion of
   * the raw base units (1e27) prints as 1000000000000000000 — a string a
   * person cannot read and a double cannot hold exactly.
   */
  const supplyCompact = formatAmount(totalSupply);

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-6 py-8">
      <div className="mx-auto grid w-full max-w-[640px] gap-4">
        <header className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {launch?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={launch.image_url}
                alt=""
                className="size-14 rounded-2xl border-[1.5px] border-beg-line object-cover"
              />
            ) : (
              <div className="grid size-14 place-items-center rounded-2xl bg-beg-lime text-2xl font-extrabold text-beg-ink">
                {name[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[clamp(24px,5vw,36px)] font-extrabold tracking-[-.04em]">{name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-beg-dim">
                <span className="font-bold">${symbol}</span>
                <span className="rounded-md bg-beg-lime px-1.5 py-0.5 text-[11px] font-bold text-beg-ink">Launched on BegFi</span>
                {record.phase !== 0 ? <span className="rounded-md bg-beg-blue px-1.5 py-0.5 text-[11px] font-bold text-beg-ink">Graduated</span> : null}
              </div>
            </div>
          </div>

          {/*
            The dense stat strip: one row on a phone, wrapping on desktop.
            Price reads first because it is what a trader scans for; MC and
            supply flank it. Every figure here is defined where it is computed
            above — none is invented for the layout's sake.
          */}
          <dl className="grid grid-cols-3 gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-card px-3 py-2.5 text-center sm:text-left">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[.06em] text-beg-dim">Price</dt>
              <dd className="text-[15px] font-extrabold text-beg-ink">
                {priceLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[.06em] text-beg-dim">MC</dt>
              <dd className="text-[15px] font-extrabold text-beg-ink">{mc ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[.06em] text-beg-dim">Supply</dt>
              <dd className="text-[15px] font-extrabold text-beg-ink">{supplyCompact}</dd>
            </div>
          </dl>

          {/*
            The contract address is the one identifier a buyer must verify
            against an explorer, so it stays copyable at a glance — the
            page-level rule stated once, enforced everywhere.
          */}
          <p className="text-center font-mono text-[12px] text-beg-dim" title={record.token}>
            <a href={addressUrl(record.token)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-beg-ink">
              {shortAddress(record.token)}
            </a>
          </p>

          {launch?.socials ? <TokenSocials socials={launch.socials} /> : null}
        </header>

        <div className="card p-4 sm:p-5">
          <TokenChart
            data={chartData}
            currentPrice={displayPrice}
            tokenSymbol={name}
          />
        </div>

        <div className="card p-4 sm:p-5">
          <BuyPanel token={record.token} curve={record.curve} pairToken={record.pairToken} />
        </div>

        <dl className="card grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] p-4 sm:p-5">
          {launch ? (
            <Row label="Launcher">
              <a
                href={addressUrl(launch.launcher_wallet)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline underline-offset-2"
              >
                {shortAddress(launch.launcher_wallet)}
              </a>
            </Row>
          ) : null}
          <Row label="Creator tax">
            <a
              href={addressUrl(record.creatorFeeRecipient)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2"
            >
              {shortAddress(record.creatorFeeRecipient)}
            </a>{" "}
            ({Number(record.creatorTaxBps) / 100}% of each trade)
          </Row>
          {curve ? (
            <>
              <Row label="Curve price">
                {curve.price === "n/a" ? "n/a" : `${curve.price} ETH`}
              </Row>
              <Row label="Pooled ETH">{curve.pooled} ETH</Row>
            </>
          ) : null}
          <Row label="Graduates at">
            {Number(record.graduationThreshold) / 1e18} ETH pooled
          </Row>
          <Row label="Curve">
            <a
              href={addressUrl(record.curve)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2"
            >
              {shortAddress(record.curve)}
            </a>
          </Row>
          {launch ? (
            <Row label="Launched">
              {new Date(launch.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </Row>
          ) : null}
        </dl>

        {holders && holders.holders.length > 0 ? (
          <HoldersList
            holders={holders.holders}
            windowBlocks={holders.windowBlocks}
            graduated={record.phase !== 0}
          />
        ) : null}

        <p className="notice">
          Launched through BegFi&apos;s launchpad, on Pons&apos; contracts. BegFi does not vet the
          tokens launched through it; this is not an endorsement, and a blockchain trade cannot be
          undone. Check the contract before you buy, and never spend more than you can lose.
        </p>
      </div>

      <section className="card-hover card flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[17px] font-bold text-beg-ink">Launch your own</p>
          <p className="mt-1 text-[13px] text-beg-dim">
            Fixed supply, a 3% creator tax paid to your wallet, one transaction.
          </p>
        </div>
        <Link href="/launch" className="btn-primary shrink-0">
          Launch a token
        </Link>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-beg-dim">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
