"use client";

import Link from "next/link";
import { useState } from "react";
import type { DashLaunch } from "@/lib/dashboard";

/**
 * One launch row on the Launches tab.
 *
 * The numbers arrive server-rendered and exact; this island only owns what the
 * server cannot: the clipboard write and the visible "shared" feedback. When a
 * figure is genuinely unknown it renders as an em gap, never a zero — a zero
 * market cap would say the token is dead, when the truth may be a failed read.
 */
export function LaunchRow({ launch: l, shareUrl }: { launch: DashLaunch; shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked; the link is rendered on the row anyway */
    }
  }

  return (
    <li className="card grid gap-3 p-4">
      <div className="flex items-center gap-3">
        {l.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.image_url} alt="" className="size-10 shrink-0 rounded-xl border-2 border-beg-ink object-cover" />
        ) : (
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-beg-ink bg-beg-lime text-base font-extrabold text-beg-ink">
            {l.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[16px] text-beg-ink">
            {l.name} <span className="text-beg-dim">${l.ticker}</span>
          </b>
          <span className="font-mono text-[11px] text-beg-dim">
            {l.token_address.slice(0, 6)}…{l.token_address.slice(-4)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold ${
            l.graduated ? "bg-beg-lime text-beg-ink" : "bg-beg-card text-beg-dim"
          }`}
        >
          {l.graduated === null ? "Checking" : l.graduated ? "Graduated" : "On the curve"}
        </span>
      </div>

      {(l.graduated === null || !l.graduated) && l.progress !== null && l.thresholdEth ? (
        <div className="grid gap-1.5">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.max(2, l.progress * 100)}%` }} />
          </div>
          <span className="text-[11px] text-beg-dim">
            {l.pooledEth ?? "?"} of {l.thresholdEth} ETH pooled
          </span>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-beg-dim">Market cap</dt>
          <dd className="font-bold text-beg-ink">{l.mc ? `ETH ${l.mc}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-beg-dim">24h volume</dt>
          <dd className="font-bold text-beg-ink">{l.volume24hEth ? `${l.volume24hEth} ETH` : "—"}</dd>
        </div>
        <div>
          <dt className="text-beg-dim">Traders 24h</dt>
          <dd className="font-bold text-beg-ink">{l.traders24h !== null ? String(l.traders24h) : "—"}</dd>
        </div>
        <div>
          <dt className="text-beg-dim">Creator tax</dt>
          <dd className="font-bold text-beg-ink">{l.taxBps !== null ? `${l.taxBps / 100}%` : "—"}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/token/${l.token_address}`} className="text-[13px] text-beg-ink underline underline-offset-2">
          Open page
        </Link>
        <button
          type="button"
          onClick={() => void copy()}
          className="btn-ghost px-3.5 py-1.5 text-[12px] font-bold text-beg-ink"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          className="rounded-full border-[1.5px] border-beg-line px-3.5 py-1.5 text-[12px] font-bold text-beg-dim hover:border-beg-ink hover:text-beg-ink"
          href={`https://x.com/intent/post?text=${encodeURIComponent(`I launched ${l.name} ($${l.ticker}) on BegFi`)}&url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          Post on X
        </a>
      </div>
    </li>
  );
}
