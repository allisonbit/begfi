import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, http, parseAbiItem } from "viem";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { ClaimFees } from "@/components/claim-fees";
import { robinhoodChain, shortAddress } from "@/lib/chains";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { getProfile, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Launches" };
export const dynamic = "force-dynamic";

/**
 * Tokens you launched, and what you can claim for them.
 *
 * Every number on this page comes from the chain, not from our database — spec
 * §9.5 says claimable fees must be read straight from the escrow contract, and
 * the same reasoning applies to the list itself: a launch is an on-chain fact,
 * and reading our own table would show nothing for a token launched a minute ago,
 * or from a wallet that launched before this site existed.
 *
 * The scan is bounded. Event logs on this chain cannot be queried over an
 * unbounded range without the public RPC refusing, so this looks back a fixed
 * window rather than pretending to enumerate everything ever.
 */
const TRANSFER_WINDOW = 200_000n;

const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

type Launched = { token: string; curve: string; creatorTaxBps: number; graduated: boolean };

async function launchesBy(wallet: string): Promise<Launched[]> {
  const head = await client.getBlockNumber();
  const from = head > TRANSFER_WINDOW ? head - TRANSFER_WINDOW : 0n;

  // Filtered by the deployer topic, so this asks the node for one wallet's
  // launches rather than every launch on the chain and filtering here.
  const logs = await client.getLogs({
    address: PONS_FACTORY,
    event: tokenLaunched,
    args: { deployer: wallet as `0x${string}` },
    fromBlock: from,
    toBlock: head,
  });

  // Annotated so the null-narrowing below type-checks: the mapped values carry
  // viem's `0x${string}` for addresses, which is narrower than the `string` on
  // `Launched`, and a predicate cannot widen a parameter.
  const found: (Launched | null)[] = await Promise.all(
    logs.map(async (log) => {
      try {
        const record = await client.readContract({
          abi: ponsFactoryAbi,
          address: PONS_FACTORY,
          functionName: "getLaunchedToken",
          args: [log.args.token as `0x${string}`],
        });
        return {
          token: record.token,
          curve: record.curve,
          creatorTaxBps: Number(record.creatorTaxBps),
          graduated: record.phase !== 0,
        };
      } catch {
        return null;
      }
    }),
  );

  return found.filter((x): x is Launched => x !== null).reverse();
}

export default async function LaunchesPage() {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your launches" />;
  }

  let launches: Launched[] = [];
  let scanFailed = false;

  try {
    launches = await launchesBy(profile.wallet_address);
  } catch {
    // The RPC refusing a log query is a real possibility and not something to
    // hide: saying the list could not be read is better than showing an empty
    // list, which reads as "you have launched nothing".
    scanFailed = true;
  }

  return (
    <div className="mx-auto grid max-w-[1000px] gap-6 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Launches</h1>
        <Link href="/dashboard" className="text-[13px] text-beg-dim underline underline-offset-2">
          Back to dashboard
        </Link>
      </header>

      <ClaimFees wallet={profile.wallet_address} />

      {scanFailed ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-ink">
          Couldn&apos;t read your launches from the chain just now. This is a problem reaching the RPC,
          not an empty list — try again shortly.
        </p>
      ) : launches.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          <p className="font-bold text-beg-ink">No launches found for this wallet.</p>
          <p className="mt-1.5">
            This looks back over a recent window, so a launch older than that won&apos;t appear here
            even though the token exists.{" "}
            <Link href="/launch" className="text-beg-ink underline underline-offset-2">
              Launch a token
            </Link>
            .
          </p>
        </div>
      ) : (
        <section className="grid gap-3">
          <h2 className="text-xl font-extrabold tracking-[-.03em]">
            {launches.length} {launches.length === 1 ? "launch" : "launches"}
          </h2>
          <ul className="grid gap-2">
            {launches.map((l) => (
              <li
                key={l.token}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-card p-4 text-[13px]"
              >
                <Link href={`/token/${l.token}`} className="font-mono text-beg-ink underline underline-offset-2">
                  {shortAddress(l.token)}
                </Link>
                <span className="text-beg-dim">{l.creatorTaxBps / 100}% tax</span>
                <span className={l.graduated ? "text-beg-lime" : "text-beg-dim"}>
                  {l.graduated ? "Graduated" : "On the curve"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
