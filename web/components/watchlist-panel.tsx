"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WatchRow } from "@/lib/watchlist-data";

/**
 * The dashboard's Watchlist section.
 *
 * Rows come from the server with the live numbers attached (server page reads
 * the curve trades the same way Explore does); the island owns only
 * interaction — the alert toggles and unwatch. A toggle is optimistic and
 * rolls back on failure with a visible note, because a chart of alerts that
 * silently disagrees with the database is worse than one that says so.
 */
export function WatchlistPanel({ rows }: { rows: WatchRow[] }) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [local, setLocal] = useState(rows);
  const [error, setError] = useState<string | null>(null);

  async function patch(token: string, body: Record<string, unknown>) {
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setError(null);
      startTransition(() => router.refresh());
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
    }
  }

  if (local.length === 0) {
    return (
      <p className="notice-dashed p-5">
        Nothing watched yet. Star a token on Explore and it shows up here with its 24h move, and
        with two honest alerts you can switch off: big moves and graduation.
      </p>
    );
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-extrabold tracking-[-.03em]">Watchlist</h2>

      {error ? <p className="notice-dashed p-4">{error}</p> : null}

      <ul className="grid gap-2">
        {local.map((w) => (
          <li key={w.token_address} className="card-sm grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 text-[14px] font-bold text-beg-ink">
                {w.name} <span className="text-beg-dim">${w.ticker}</span>
              </div>
              {w.priceChange24h !== null ? (
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-bold ${
                    w.priceChange24h >= 0 ? "bg-beg-lime text-beg-ink" : "bg-beg-yellow text-beg-ink"
                  }`}
                >
                  {w.priceChange24h >= 0 ? "+" : ""}
                  {w.priceChange24h.toFixed(1)}%
                </span>
              ) : (
                <span className="shrink-0 text-[12px] text-beg-dim">no trades yet</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setLocal((ls) => ls.filter((x) => x.token_address !== w.token_address));
                  void patch(w.token_address, { action: "toggle", tokenAddress: w.token_address, watched: false });
                }}
                className="shrink-0 text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink"
              >
                Unwatch
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[12px]">
              <Toggle
                label="Alert on big moves"
                on={w.alert_on_move}
                onToggle={() => {
                  setLocal((ls) =>
                    ls.map((x) =>
                      x.token_address === w.token_address ? { ...x, alert_on_move: !x.alert_on_move } : x,
                    ),
                  );
                  void patch(w.token_address, {
                    action: "alerts",
                    tokenAddress: w.token_address,
                    alertOnMove: !w.alert_on_move,
                  });
                }}
              />
              <Toggle
                label="Alert on graduation"
                on={w.alert_on_graduation}
                onToggle={() => {
                  setLocal((ls) =>
                    ls.map((x) =>
                      x.token_address === w.token_address ? { ...x, alert_on_graduation: !x.alert_on_graduation } : x,
                    ),
                  );
                  void patch(w.token_address, {
                    action: "alerts",
                    tokenAddress: w.token_address,
                    alertOnGraduation: !w.alert_on_graduation,
                  });
                }}
              />
              <span className="text-beg-dim">
                Alerts land in the bell on the next indexer run, only if the chain shows the move.
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`rounded-full border-[1.5px] px-3 py-1 font-bold transition-colors ${
        on ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
      }`}
    >
      {on ? "On" : "Off"} · {label}
    </button>
  );
}
