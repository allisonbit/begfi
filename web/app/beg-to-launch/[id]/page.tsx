import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SendPanel } from "@/components/send-panel";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, publicUrl } from "@/lib/config";
import { ageWords } from "@/lib/format";
import { formatAmount } from "@/lib/erc20";
import { getLaunchBegSupporters, sumSupporters } from "@/lib/launch-begs";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { LaunchBeg } from "@/lib/launch-begs";

type Params = { id: string };

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One beg-to-launch at its own URL.
 *
 * THE MONEY PATH, stated once and everywhere the same way: supporters send
 * $BEG from their wallet to the creator's wallet, exactly as any send on this
 * site works. The progress bar counts confirmed on-chain transfers that
 * arrived after the ask opened; the supporter list shows them. Nothing is
 * escrowed, nothing is refundable, and the launch itself happens later through
 * the normal launch form (a launch fee still applies) — supporting a beg is
 * not buying the future token, and the page says so before the send panel
 * renders.
 */
async function getBeg(id: string): Promise<LaunchBeg | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("launch_begs")
    .select("id, profile_id, token_name, token_ticker, one_liner, goal, created_at, funded_at, funded_tx")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      profile_id: string;
      token_name: string;
      token_ticker: string;
      one_liner: string;
      goal: string;
      created_at: string;
      funded_at: string | null;
      funded_tx: string | null;
    }>();

  if (error || !row) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("username, display_name, avatar_url, wallet_address, is_hidden")
    .eq("id", row.profile_id)
    .maybeSingle<{
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      wallet_address: string;
      is_hidden: boolean;
    }>();

  if (!profile || profile.is_hidden) return null;

  return {
    id: row.id,
    profile_id: row.profile_id,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    wallet_address: profile.wallet_address,
    token_name: row.token_name,
    token_ticker: row.token_ticker,
    one_liner: row.one_liner,
    goal: row.goal,
    created_at: row.created_at,
    funded_at: row.funded_at,
    funded_tx: row.funded_tx,
  };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Not found" };
  const beg = await getBeg(id);
  if (!beg) return { title: "Not found" };
  const title = `${beg.token_name} ($${beg.token_ticker}) beg to launch`;
  return {
    title,
    description: beg.one_liner,
    openGraph: { title, description: beg.one_liner, type: "website", url: `/beg-to-launch/${id}` },
    twitter: { card: "summary_large_image", title, description: beg.one_liner },
  };
}

export default async function LaunchBegPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const beg = await getBeg(id);
  if (!beg) notFound();

  const supporters = await getLaunchBegSupporters(beg.wallet_address, beg.created_at);
  const raised = sumSupporters(supporters);
  const goal = BigInt(beg.goal);
  const ratio = goal > 0n ? Number(raised) / Number(goal) : 0;
  const pct = Math.min(100, Math.round(ratio * 100));

  return (
    <div className="safe-x mx-auto grid max-w-[560px] gap-8 py-10">
      <header className="grid gap-2 text-center">
        <span className="mx-auto w-fit rounded-full border-2 border-beg-ink bg-beg-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
          Beg to launch
        </span>
        <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">
          {beg.token_name}
        </h1>
        <p className="text-beg-dim">
          ${beg.token_ticker} · by{" "}
          <Link href={`/${beg.username}`} className="underline underline-offset-2">
            @{beg.username}
          </Link>
        </p>
        <p className="mx-auto max-w-[46ch] text-[15px] text-beg-ink">{beg.one_liner}</p>
        <p className="font-mono text-[13px] text-beg-dim" title={beg.wallet_address}>
          {shortAddress(beg.wallet_address)}
        </p>
        <p className="text-[12px] text-beg-dim">Opened {ageWords(beg.created_at)} ago</p>
      </header>

      <section className="card grid gap-3">
        <div className="flex items-baseline justify-between">
          <b className="text-[15px]">Progress</b>
          <span className="text-[13px] text-beg-dim">
            {formatAmount(raised)} of {formatAmount(goal)} $BEG
          </span>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <span className="text-[12px] text-beg-dim">
          {pct}% toward the goal. Confirmed transfers to this wallet since the ask opened; nothing
          is counted that the chain has not confirmed.
        </span>
      </section>

      <section className="card p-6">
        {BEG_CONFIGURED ? (
          <>
            <SendPanel recipient={beg.wallet_address} username={beg.username} />
            <p className="notice mt-4">
              This is a send to {shortAddress(beg.wallet_address)}, the same kind of transaction as
              any send on BegFi. It is not a purchase, the future token is not owed, and a
              blockchain send cannot be undone. Nothing on this page is financial advice.
            </p>
          </>
        ) : (
          <div className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-center">
            <p className="font-bold text-beg-ink">Sending isn&apos;t live yet</p>
            <p className="mt-1.5 text-[13px] text-beg-dim">
              $BEG hasn&apos;t been launched, so there is no token to send toward this beg. The
              ask still shows its supporters the moment it is.
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Supporters</h2>
        {supporters.length === 0 ? (
          <p className="notice-dashed p-5">
            No supporters yet. The first confirmed send lands here with its amount and its
            transaction, not a name invented for an empty slot.
          </p>
        ) : (
          <ul className="grid gap-2">
            {supporters.map((s) => (
              <li
                key={`${s.tx_hash}-${s.block_time}`}
                className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <span className="font-mono text-beg-dim">{shortAddress(s.from_address)}</span>
                <span className="text-beg-dim">{new Date(s.block_time).toLocaleString("en-GB")}</span>
                <span className="font-bold text-beg-ink">{formatAmount(BigInt(s.amount))} $BEG</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[13px] text-beg-dim">
        See all asks on the{" "}
        <Link href="/beg-to-launch" className="underline underline-offset-2">
          begs to launch
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
