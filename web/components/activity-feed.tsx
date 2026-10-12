"use client";

import { useState } from "react";
import type { FeedItem } from "@/lib/dashboard";

/**
 * The Activity island.
 *
 * All of the data is already server-rendered; filtering is a useState over
 * item kinds, so switching tabs between kinds costs no fetch and happens even
 * offline. The kinds are rendered as real buttons with `aria-pressed` rather
 * than coloured text, so a screen reader and a sighted reader get the same
 * answer to "which filter is on".
 */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "beg", label: "Begs" },
  { key: "trade", label: "Trades" },
  { key: "launch", label: "Launches" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export function ActivityFeed({
  items,
  explorerHref,
}: {
  items: FeedItem[];
  explorerHref: (tx: string) => string;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  const counts = {
    beg: items.filter((i) => i.kind === "beg").length,
    trade: items.filter((i) => i.kind === "trade").length,
    launch: items.filter((i) => i.kind === "launch").length,
  };

  return (
    <section className="grid gap-3">
      <nav aria-label="Filter activity" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const pressed = filter === f.key;
          const count = f.key === "all" ? items.length : counts[f.key as keyof typeof counts];
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={pressed}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
                pressed ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
              }`}
            >
              {f.label} <span className="font-mono text-[11px]">{count}</span>
            </button>
          );
        })}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          {items.length === 0
            ? "Nothing here yet, across every filter. This lists confirmed on-chain events only, so the first real event puts the first row here."
            : `No ${filter === "all" ? "" : filter} entries yet. Everything on this feed is confirmed on-chain; nothing is invented for an empty slot.`}
        </p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((item, i) => (
            <li
              key={`${item.kind}-${item.at}-${item.tx ?? "notx"}-${i}`}
              className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]"
            >
              <span className="flex items-center gap-2">
                <KindBadge kind={item.kind} />
                <span className="text-beg-ink">{item.text}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-beg-dim">{new Date(item.at).toLocaleString("en-GB")}</span>
                {item.tx ? (
                  <a
                    href={explorerHref(item.tx)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-beg-ink underline underline-offset-2"
                  >
                    Explorer
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KindBadge({ kind }: { kind: FeedItem["kind"] }) {
  const bg = kind === "beg" ? "bg-beg-lime" : kind === "trade" ? "bg-beg-blue" : "bg-beg-yellow";
  const label = kind === "beg" ? "Beg" : kind === "trade" ? "Trade" : "Launch";
  return (
    <span className={`rounded-md border-2 border-beg-ink ${bg} px-1.5 py-0.5 text-[10px] font-extrabold text-beg-ink`}>
      {label}
    </span>
  );
}
