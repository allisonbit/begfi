import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, http, parseAbiItem } from "viem";
import { robinhoodChain, shortAddress } from "@/lib/chains";
import { erc20Abi } from "@/lib/erc20";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";

export const metadata: Metadata = {
  title: "Explore",
  description: "Tokens launched on Robinhood Chain through BegFi.",
};

/** Re-read every couple of minutes rather than on every request. */
export const revalidate = 120;

/**
 * Recent launches.
 *
 * READ FROM THE FACTORY, not from our database. A launch is an on-chain fact, and
 * most of the tokens here were launched by someone who has never heard of BegFi —
 * they are simply what the factory has produced. Reading `begfi.launches` would
 * show an empty page for a contract that has seen hundreds of launches.
 *
 * The scan is BOUNDED, and deliberately so: an unbounded `eth_getLogs` over this
 * chain is refused by the public RPC, so this looks back a fixed window instead
 * of pretending to enumerate everything. The page says so rather than implying
 * it is the whole picture.
 */
const WINDOW = 150_000n;

const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

type Listed = {
  token: string;
  curve: string;
  deployer: string;
  name: string;
  symbol: string;
  graduated: boolean;
};

async function recentLaunches(limit = 24): Promise<{ items: Listed[]; failed: boolean }> {
  try {
    const head = await client.getBlockNumber();
    const from = head > WINDOW ? head - WINDOW : 0n;

    const logs = await client.getLogs({
      address: PONS_FACTORY,
      event: tokenLaunched,
      fromBlock: from,
      toBlock: head,
    });

    // Newest first, and only as many as will be shown — every extra row costs
    // three RPC calls below.
    const newest = logs.slice(-limit).reverse();

    // Annotated for the same reason as the launches page: the mapped values
    // carry viem's `0x${string}`, which is narrower than `Listed`'s `string`.
    const items: (Listed | null)[] = await Promise.all(
      newest.map(async (log) => {
        const token = log.args.token as `0x${string}`;
        try {
          const [name, symbol, record] = await Promise.all([
            client.readContract({ abi: erc20Abi, address: token, functionName: "name" }),
            client.readContract({ abi: erc20Abi, address: token, functionName: "symbol" }),
            client.readContract({
              abi: ponsFactoryAbi,
              address: PONS_FACTORY,
              functionName: "getLaunchedToken",
              args: [token],
            }),
          ]);
          return {
            token,
            curve: log.args.curve as string,
            deployer: log.args.deployer as string,
            name,
            symbol,
            graduated: record.phase !== 0,
          };
        } catch {
          // A token whose metadata is unreadable is skipped rather than shown
          // as a blank card. It still exists on-chain; this list is a view.
          return null;
        }
      }),
    );

    return { items: items.filter((x): x is Listed => x !== null), failed: false };
  } catch {
    return { items: [], failed: true };
  }
}

export default async function ExplorePage() {
  const { items, failed } = await recentLaunches();

  return (
    <div className="mx-auto grid max-w-[1000px] gap-6 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Explore</h1>
          <p className="mt-1 text-beg-dim">Recently launched on Robinhood Chain.</p>
        </div>
        <Link
          href="/launch"
          className="rounded-full bg-beg-lime px-5 py-3 text-[14px] font-bold text-beg-bg"
        >
          Launch a token
        </Link>
      </header>

      {failed ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-ink">
          Couldn&apos;t read recent launches just now — that&apos;s a problem reaching the chain, not
          an empty list. Try again shortly.
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
          Nothing launched in the recent window this page scans.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.token}>
              <Link
                href={`/token/${item.token}`}
                className="block rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-5 transition-colors hover:border-beg-lime"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b className="truncate text-[18px] text-beg-ink">{item.name}</b>
                  <span className="shrink-0 text-[13px] text-beg-lime">${item.symbol}</span>
                </div>
                <p className="mt-2 font-mono text-[12px] text-beg-dim">{shortAddress(item.token)}</p>
                <p className="mt-3 flex items-center justify-between text-[12px] text-beg-dim">
                  <span>by {shortAddress(item.deployer)}</span>
                  <span className={item.graduated ? "text-beg-lime" : ""}>
                    {item.graduated ? "Graduated" : "On the curve"}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        Spec §12: the disclaimer belongs wherever strangers' tokens are listed.
        This is the page most likely to be mistaken for an endorsement.
      */}
      <p className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px] text-beg-dim">
        Anyone can launch a token, and most of these were not launched by anyone at BegFi. Listing
        them here is not an endorsement, a review, or advice. Check a contract before you trade it.
      </p>
    </div>
  );
}
