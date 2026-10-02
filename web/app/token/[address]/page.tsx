import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createPublicClient, http, isAddress } from "viem";
import { BuyPanel } from "@/components/buy-panel";
import { SiteNav } from "@/components/site-nav";
import { addressUrl, robinhoodChain, shortAddress } from "@/lib/chains";
import { erc20Abi } from "@/lib/erc20";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";

type Params = { address: string };

export const dynamic = "force-dynamic";

/**
 * A launched token's page.
 *
 * THE CHAIN IS THE SOURCE OF TRUTH, not our database. Launches go through Pons'
 * factory, so `getLaunchedToken(token)` on-chain is authoritative and complete —
 * it carries the curve address, the creator, the tax and the phase. Reading from
 * `begfi.launches` instead would mean a token that launched a minute ago 404s
 * until an indexer caught up, and would make our table a second place the truth
 * could be wrong.
 *
 * The database copy is still useful for search and for joining a launch to a
 * BegFi profile, but it is not what decides whether this page renders.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

async function getLaunch(token: string) {
  try {
    const [record, name, symbol] = await Promise.all([
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
    ]);

    if (!record.exists) return null;
    return { record, name, symbol };
  } catch {
    // A token that does not exist makes the factory revert, and a plain address
    // with no contract makes the reads fail. Both mean "no such token here".
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: "Not found" };

  const found = await getLaunch(address);
  if (!found) return { title: "Token not found" };

  return {
    title: `${found.name} ($${found.symbol})`,
    description: `${found.name} on BegFi — launched on Robinhood Chain.`,
  };
}

export default async function TokenPage({ params }: { params: Promise<Params> }) {
  const { address } = await params;

  if (!isAddress(address)) notFound();

  const found = await getLaunch(address);
  if (!found) notFound();

  const { record, name, symbol } = found;

  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />

      <main className="mx-auto grid max-w-[560px] gap-6 py-10">
        <header className="text-center">
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">{name}</h1>
          <p className="text-beg-dim">${symbol}</p>
          <p className="mt-2 font-mono text-[13px] text-beg-dim" title={record.token}>
            {shortAddress(record.token)}
          </p>
        </header>

        <div className="rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-6">
          <BuyPanel token={record.token} curve={record.curve} pairToken={record.pairToken} />
        </div>

        <dl className="grid gap-2 rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px]">
          <Row label="Creator">
            <a
              href={addressUrl(record.creatorFeeRecipient)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2"
            >
              {shortAddress(record.creatorFeeRecipient)}
            </a>
          </Row>
          <Row label="Creator tax">{Number(record.creatorTaxBps) / 100}% of each trade</Row>
          <Row label="Status">
            {record.phase === 0 ? "On the curve" : "Graduated"}
          </Row>
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
        </dl>

        {/*
          Spec §12 requires this on token pages, and it is simply true: BegFi
          does not vet what anyone launches through it.
        */}
        <p className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px] text-beg-dim">
          Anyone can launch a token. Tokens here are not endorsed by BegFi or Robinhood. Check the
          contract before trading, and never spend more than you can lose.
        </p>
      </main>
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
