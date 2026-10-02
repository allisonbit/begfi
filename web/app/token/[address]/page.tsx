import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { addressUrl, shortAddress } from "@/lib/chains";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Launch } from "@/lib/types";

type Params = { address: string };

export const dynamic = "force-dynamic";

async function getLaunch(address: string): Promise<Launch | null> {
  if (!SUPABASE_CONFIGURED || !/^0x[0-9a-f]{40}$/.test(address)) return null;

  const sb = await createClient();
  const { data } = await sb
    .from("launches")
    .select("*")
    .eq("token_address", address)
    .maybeSingle<Launch>();

  return data;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { address } = await params;
  const launch = await getLaunch(address.toLowerCase());

  if (!launch) return { title: "Token not found" };

  return {
    title: `${launch.name} ($${launch.ticker})`,
    description: `${launch.name} on BegFi. Launched by ${shortAddress(launch.launcher_wallet)}.`,
  };
}

/**
 * A launched token's page.
 *
 * Reads from `begfi.launches`, which the service role writes only after a deploy
 * is confirmed on-chain. Anything not in that table 404s rather than rendering a
 * page built from an address someone typed.
 */
export default async function TokenPage({ params }: { params: Promise<Params> }) {
  const { address } = await params;
  const launch = await getLaunch(address.toLowerCase());

  if (!launch) notFound();

  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />

      <main className="mx-auto grid max-w-[560px] gap-6 py-10">
        <header>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">{launch.name}</h1>
          <p className="text-beg-dim">
            ${launch.ticker} · {launch.mode === "genesis" ? "First launch" : "Standard launch"}
          </p>
          <p className="mt-2 font-mono text-[13px] text-beg-dim" title={launch.token_address}>
            {shortAddress(launch.token_address)}
          </p>
        </header>

        <dl className="grid gap-3 rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-5 text-[13px]">
          <Row label="Launched by">
            <span className="font-mono">{shortAddress(launch.launcher_wallet)}</span>
          </Row>
          <Row label="Splitter">
            {launch.splitter_address ? (
              <a
                href={addressUrl(launch.splitter_address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline underline-offset-2"
              >
                {shortAddress(launch.splitter_address)}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Token">
            <a
              href={addressUrl(launch.token_address)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              View on the explorer
            </a>
          </Row>
        </dl>

        {/*
          Spec §12 requires this notice on token pages, and it is the honest
          thing to say: BegFi does not vet what anyone launches through it.
        */}
        <p className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px] text-beg-dim">
          Anyone can launch a token. Tokens here are not endorsed by BegFi or Robinhood. Check the
          contract before trading anything.
        </p>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-beg-dim">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
