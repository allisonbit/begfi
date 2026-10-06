import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, http } from "viem";
import { robinhoodChain, shortAddress } from "@/lib/chains";
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
 * Tokens launched from BegFi, newest first.
 *
 * THE CATALOG IS THE DATABASE, NOT THE FACTORY. Pons' factory is shared —
 * anyone on the chain can call it, and scanning its events would fill this
 * page with tokens that have nothing to do with BegFi while wearing its name.
 * A token appears here only if `/api/launch` recorded it, and it only recorded
 * it after proving, on-chain, that the launcher's own wallet signed it.
 *
 * Status still comes from the chain, live: `getLaunchedToken` says whether the
 * curve has graduated. A status read that fails is left blank rather than
 * guessed.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

type Listed = Launch & {
  graduated: boolean | null;
  /** Live curve numbers; null when graduated, unreadable, or still unknown. */
  curve: { price: string; pooled: string } | null;
};

async function recentLaunches(limit = 24): Promise<{ items: Listed[]; dbFailed: boolean }> {
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
          return { ...launch, graduated: record.phase !== 0, curve: null };
        }

        try {
          const [quoteReserve, tokenReserve] = await client.readContract({
            abi: ponsCurveAbi,
            address: record.curve,
            functionName: "getReserves",
          });
          return {
            ...launch,
            graduated: false,
            curve: {
              price: pricePerToken(quoteReserve, tokenReserve),
              pooled: formatEth(quoteReserve > phantom ? quoteReserve - phantom : 0n),
            },
          };
        } catch {
          // The curve read failed; the status stays, the numbers stay out.
          return { ...launch, graduated: false, curve: null };
        }
      } catch {
        // The token is in the catalog; its live status is just unreadable.
        return { ...launch, graduated: null, curve: null };
      }
    }),
  );

  return { items, dbFailed: false };
}

export default async function ExplorePage() {
  const { items, dbFailed } = await recentLaunches();

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Explore</h1>
          <p className="mt-1 text-beg-dim">Launched on BegFi, newest first.</p>
        </div>
        <Link href="/launch" className="btn-primary">
          Launch a token
        </Link>
      </header>

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
          {items.map((item) => (
            <li key={item.token_address}>
              <Link href={`/token/${item.token_address}`} className="card-hover card flex gap-3">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="size-12 shrink-0 rounded-xl border-[1.5px] border-beg-line object-cover"
                  />
                ) : (
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-beg-lime text-xl font-extrabold text-beg-bg">
                    {item.name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="truncate text-[18px] text-beg-ink">{item.name}</b>
                    <span className="shrink-0 text-[13px] text-beg-lime">${item.ticker}</span>
                  </div>
                  <p className="mt-1 font-mono text-[12px] text-beg-dim">
                    {shortAddress(item.token_address)}
                  </p>
                  {item.curve ? (
                    <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate font-mono font-bold text-beg-ink">
                        {item.curve.price === "n/a" ? "n/a" : `${item.curve.price} ETH`}
                      </span>
                      <span className="shrink-0 text-beg-dim">{item.curve.pooled} ETH pooled</span>
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-center justify-between text-[12px] text-beg-dim">
                    {/* Plain text, not a link: the whole card is one already,
                        and an anchor inside an anchor is not HTML. */}
                    <span>by {shortAddress(item.launcher_wallet)}</span>
                    {item.graduated !== null ? (
                      <span className={item.graduated ? "text-beg-lime" : ""}>
                        {item.graduated ? "Graduated" : "On the curve"}
                      </span>
                    ) : null}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

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
