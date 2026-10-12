"use client";

import { useState } from "react";
import { formatEther } from "viem";
import type { FeePoint, FeeHistoryResult } from "@/lib/fees-history";

/**
 * The Fees tab's history chart.
 *
 * THE POINTS ARE THE CHART. No library: a token's fee history is a thin SVG
 * polyline over day buckets, and pulling in a charting dependency for six
 * points' worth of line would be heavier than the data. The y-axis has no
 * labels because the exact per-day figures sit in each point's title
 * attribute — hovering (or a screen reader) reads the real number, while the
 * line answers the question a chart exists for: which days earned.
 *
 * Gaps are drawn as gaps. A day with no trades has no point; connecting the
 * neighbours with a straight segment would read as "earned the same both
 * days", which is a lie the bucket boundaries cannot support.
 *
 * The filters are client-side over data the server already fetched for all
 * three windows (server page calls this with `all` and client slices from the
 * right end) — no fetch on filter click, and the ancestor `FeeHistoryResult`
 * typing keeps the numbers identical to the escrow figures shown beside it.
 */
const RANGES = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "all", label: "All", days: 365 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

export function FeeChart({ history }: { history: FeeHistoryResult }) {
  const [range, setRange] = useState<RangeKey>("7d");

  if (history.dbFailed) {
    return (
      <p className="notice-dashed p-5">
        Couldn&apos;t read the fee history just now. This is the indexer data, not an empty chart.
        Fees are still accruing; try again in a moment.
      </p>
    );
  }

  const days = RANGES.find((r) => r.key === range)!.days;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const shown = history.points.filter((p) => new Date(`${p.day}T00:00:00Z`).getTime() >= since);
  const total = shown.reduce((sum, p) => sum + BigInt(p.wei), 0n);

  const width = 320;
  const height = 96;
  const maxWei = shown.reduce((m, p) => (BigInt(p.wei) > m ? BigInt(p.wei) : m), 0n);

  const pts = shown.map((p, i) => {
    const x = shown.length === 1 ? width / 2 : (i / (shown.length - 1)) * width;
    const y = maxWei === 0n ? height : height - (Number(BigInt(p.wei)) / Number(maxWei)) * (height - 6);
    return { ...p, x, y };
  });

  const segments: string[][] = [];
  let current: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const gapDays =
        (new Date(`${pts[i].day}T00:00:00Z`).getTime() - new Date(`${pts[i - 1].day}T00:00:00Z`).getTime()) /
        86_400_000;
      if (gapDays > 1) {
        segments.push(current);
        current = [];
      }
    }
    current.push(`${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`);
  }
  segments.push(current);

  return (
    <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-extrabold tracking-[-.03em] text-beg-ink">Fees over time</h2>
        <nav aria-label="Chart range" className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full border-[1.5px] px-3 py-1 text-[12px] font-bold ${
                range === r.key ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim"
              }`}
            >
              {r.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="text-[13px] text-beg-dim">
        In this window:{" "}
        <b className="text-beg-ink">
          {total === 0n ? "0" : trimEth(formatEther(total))} ETH
        </b>{" "}
        of creator taxes on confirmed trades
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          No fee-bearing trades in this window yet. Taxes are recorded the moment a trade confirms;
          the chart fills as your tokens trade.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-24 w-full"
          role="img"
          aria-label={`Fees earned per day in the last ${RANGES.find((r) => r.key === range)!.label}. Total ${trimEth(formatEther(total))} ETH.`}
        >
          {segments.map((seg, si) =>
            seg.length > 1 ? (
              <polyline
                key={si}
                points={seg.join(" ")}
                fill="none"
                stroke="var(--color-beg-ink)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle key={si} cx={seg[0].split(",")[0]} cy={seg[0].split(",")[1]} r="3" fill="var(--color-beg-logo)" />
            ),
          )}
          {pts.map((p) => (
            <circle key={p.day} cx={p.x} cy={p.y} r="2.5" fill="var(--color-beg-logo)">
              <title>{`${p.day}: ${trimEth(formatEther(BigInt(p.wei)))} ETH`}</title>
            </circle>
          ))}
        </svg>
      )}

      <p className="text-[11px] text-beg-dim">
        Creator taxes on confirmed curve trades of tokens this wallet launched, per UTC day. What
        is claimable right now comes only from the escrow balance above; taxes recorded here land
        there when the claim is made.
      </p>
    </section>
  );
}

function trimEth(text: string): string {
  if (text === "0") return "0";
  if (text.includes(".")) {
    const [whole, frac] = text.split(".");
    if (Number(whole) >= 1) return `${whole}.${frac.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "");
    return `0.${frac.slice(0, 6).replace(/0+$/, "")}` || "0";
  }
  return text;
}
