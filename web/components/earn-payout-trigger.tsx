"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Trigger a payout sweep NOW.
 *
 * This is deliberately NOT an approval control: the sweep runs the same
 * automatic path the cron and the funds trigger run, and it pays only rows
 * the lease still awards. The button exists for the admin to see the machine
 * working between scheduled runs — before funding a wallet, after one, or
 * during the backlog. The result line reports counts and stopped-reasons in
 * plain words rather than a generic "done".
 */
export function PayoutTrigger() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/earn/payouts/run", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; sentCount?: number; failedCount?: number; stopped?: string; error?: string; notes?: string[] }
        | null;
      if (!response.ok || !body?.ok) {
        setResult(body?.error ?? "The sweep could not run — check the server logs.");
        return;
      }
      if (body.stopped) {
        setResult(`Nothing was sent (${body.stopped}). The wallets stay pending.`);
      } else {
        setResult(`${body.sentCount ?? 0} wallet(s) paid, ${body.failedCount ?? 0} failed. The console below re-reads from the chain.`);
        router.refresh();
      }
    } catch {
      setResult("Network error — the wallets are untouched. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card-sm grid gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <b className="text-beg-ink">Trigger a sweep now</b>
          <p className="text-[12px] text-beg-dim">
            Same automatic path as the daily cron and the funds trigger — never an approval.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-full border-[1.5px] border-beg-ink bg-beg-lime px-4 py-2 text-[13px] font-bold text-beg-ink disabled:opacity-50"
        >
          {running ? "Sweeping…" : "Run the sweep"}
        </button>
      </div>
      {result && <p className="text-[12px] text-beg-dim">{result}</p>}
    </div>
  );
}
