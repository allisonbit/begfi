import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createPublicClient, http, isAddress } from "viem";
import { BuyPanel } from "@/components/buy-panel";
import { addressUrl, robinhoodChain, shortAddress } from "@/lib/chains";
import { formatEth, ponsCurveAbi, pricePerToken } from "@/lib/curve";
import { erc20Abi } from "@/lib/erc20";
import { LAUNCH_CONFIG_ID, PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
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
  ]).catch(() => null);

  // A recorded token the chain no longer confirms — or a read that failed — is
  // refused rather than rendered from the row alone.
  if (!results) return null;
  const [record, name, symbol] = results;
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

  return { launch, record, name, symbol, curve };
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

  const { launch, record, name, symbol, curve } = found;

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-12 py-8">
      <div className="mx-auto grid w-full max-w-[560px] gap-6">
        <header className="grid justify-items-center gap-3 text-center">
          {launch?.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={launch.image_url}
              alt=""
              className="size-16 rounded-2xl border-[1.5px] border-beg-line object-cover"
            />
          ) : (
            <div className="grid size-16 place-items-center rounded-2xl bg-beg-lime text-2xl font-extrabold text-beg-bg">
              {name[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">{name}</h1>
            <p className="text-beg-dim">${symbol}</p>
          </div>
          <p className="font-mono text-[13px] text-beg-dim" title={record.token}>
            {shortAddress(record.token)}
          </p>
          <p className="text-[12px] text-beg-lime">Launched on BegFi</p>
        </header>

        <div className="card p-6">
          <BuyPanel token={record.token} curve={record.curve} pairToken={record.pairToken} />
        </div>

        <dl className="card grid gap-2 text-[13px]">
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
          <Row label="Status">
            {record.phase === 0 ? "On the curve" : "Graduated"}
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
