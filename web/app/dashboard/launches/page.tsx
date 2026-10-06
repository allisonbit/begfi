import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, http, parseAbiItem } from "viem";
import { ClaimFees } from "@/components/claim-fees";
import { robinhoodChain, shortAddress } from "@/lib/chains";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Launches" };
export const dynamic = "force-dynamic";

/**
 * Tokens you launched, and what you can claim for them.
 *
 * Every number comes from the chain, not from our database — spec §9.5 says
 * claimable fees must be read straight from the escrow contract, and the same
 * reasoning applies to the list: a launch is an on-chain fact, and reading our
 * own table would show nothing for a token launched a minute ago.
 *
 * The scan is bounded. Event logs on this chain cannot be queried over an
 * unbounded range without the public RPC refusing, so this looks back a fixed
 * window rather than pretending to enumerate everything ever.
 */
const WINDOW = 200_000n;

const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

type Launched = { token: string; creatorTaxBps: number; graduated: boolean };

async function launchesBy(wallet: string): Promise<Launched[]> {
  const head = await client.getBlockNumber();
  const from = head > WINDOW ? head - WINDOW : 0n;

  const logs = await client.getLogs({
    address: PONS_FACTORY,
    event: tokenLaunched,
    args: { deployer: wallet as `0x${string}` },
    fromBlock: from,
    toBlock: head,
  });

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
  if (!profile) return null;

  let launches: Launched[] = [];
  let scanFailed = false;

  try {
    launches = await launchesBy(profile.wallet_address);
  } catch {
    // The RPC refusing a log query is a real possibility and not something to
    // hide: saying the list could not be read beats showing an empty one, which
    // reads as "you have launched nothing".
    scanFailed = true;
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Launches</h1>
          <p className="mt-1 text-beg-dim">Tokens you launched, and the fees they have earned you.</p>
        </div>         <Link href="/launch" className="btn-primary">
          Launch a token
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
            even though the token exists.
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
                className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]"
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
    </>
  );
}
