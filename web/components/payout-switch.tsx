"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * THE SWITCH, IN THE HANDS OF THE PERSON ON CALL.
 *
 * This is the only control on the site that stops money, so its UI rules are
 * deliberately unlike the rest of the product's:
 *
 *   * THE CURRENT STATE IS THE HEADLINE, not a hidden setting. If payouts are
 *     paused, whoever opens this page sees that first, with the reason and who
 *     flipped it — an incident review should never have to ask "is it still
 *     off?".
 *   * PAUSING TAKES TWO CLICKS, RESUMING DOES NOT. An accidental resume during
 *     an incident sends money that was deliberately held; an accidental pause
 *     costs a delayed payout that the next sweep picks up. Those are not
 *     equally bad, so they do not get the same friction.
 *   * THE REASON IS ASKED FOR BEFORE THE FLIP, because `reason` is what every
 *     earner and project owner will read on a failed button. A blank reason is
 *     allowed, and the server wording covers it — but the field is right there.
 *   * EVERY RESULT IS A SENTENCE. "Paused" and "not paused — the request
 *     failed" are different outcomes and the copy says which one happened.
 */
export function PayoutSwitch({
  initialPaused,
  initialReason,
  initialBy,
  initialAt,
  readOk,
}: {
  initialPaused: boolean;
  initialReason: string | null;
  initialBy: string | null;
  initialAt: string | null;
  readOk: boolean;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function flip(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: next, reason: next ? reason.trim() || null : null }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; controls?: { is_paused: boolean }; error?: string }
        | null;

      if (!response.ok || !body?.ok) {
        // The state is NOT assumed to have changed: a failed request leaves the
        // switch where it was, and saying otherwise could make someone believe
        // the bleeding stopped when it did not.
        setMessage(body?.error ?? "The switch did not change — nothing was stopped. Try again.");
        return;
      }

      const nowPaused = body.controls?.is_paused ?? next;
      setPaused(nowPaused);
      setConfirming(false);
      setReason("");
      setMessage(
        nowPaused
          ? "Payouts are paused. Nothing new leaves the wallet; queued money is untouched and resumes on the next sweep."
          : "Payouts are running again. Queued payouts resume on the next sweep.",
      );
      router.refresh();
    } catch {
      setMessage("Network error — the switch did not change. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[.06em] text-beg-dim">
            Global payout switch
          </span>
          <b className="text-[20px] font-extrabold text-beg-ink">
            {!readOk
              ? "Unreadable — treated as paused"
              : paused
                ? "Paused — no money is leaving"
                : "Running — payouts are automatic"}
          </b>
          {paused && initialReason && (
            <span className="text-[12px] text-beg-dim">
              Reason: {initialReason}
              {initialBy ? ` · flipped by ${initialBy.slice(0, 6)}…${initialBy.slice(-4)}` : ""}
              {initialAt ? ` · ${new Date(initialAt).toLocaleString("en-GB")}` : ""}
            </span>
          )}
          {!readOk && (
            <span className="text-[12px] text-beg-dim">
              The switch row could not be read, so every payout path is parking itself until it can be —
              that is the fail-closed rule, not a stall.
            </span>
          )}
          <span className="text-[12px] text-beg-dim">
            One row decides for the $BEGFI pool and every campaign alike. Read at the top of every sweep,
            claim and submission — so this is the first thing to reach for when something looks wrong.
          </span>
        </div>

        {paused ? (
          <button
            type="button"
            onClick={() => void flip(false)}
            disabled={busy || !readOk}
            className="rounded-full border-[1.5px] border-beg-ink bg-beg-lime px-4 py-2 text-[13px] font-bold text-beg-ink disabled:opacity-50"
          >
            {busy ? "Resuming…" : "Resume payouts"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || confirming}
            className="rounded-full border-[1.5px] border-beg-ink bg-beg-card px-4 py-2 text-[13px] font-bold text-beg-ink disabled:opacity-50"
          >
            Pause all payouts
          </button>
        )}
      </div>

      {confirming && !paused && (
        <div className="grid gap-2 rounded-2xl border-[1.5px] border-beg-ink bg-beg-bg p-3">
          <label className="grid gap-1">
            <span className="text-[12px] font-bold text-beg-ink">
              Why? (shown to every earner and project owner while it is off)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 160))}
              placeholder="Investigating a wallet imbalance — payouts resume shortly."
              className="rounded-xl border-[1.5px] border-beg-line bg-beg-card p-2.5 text-[14px] text-beg-ink outline-none focus:border-beg-lime"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void flip(true)}
              disabled={busy}
              className="rounded-full border-[1.5px] border-beg-ink bg-beg-card px-4 py-2 text-[13px] font-bold text-beg-ink disabled:opacity-50"
            >
              {busy ? "Pausing…" : "Yes — pause everything"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setReason("");
              }}
              disabled={busy}
              className="rounded-full px-4 py-2 text-[13px] font-bold text-beg-dim disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-[12px] text-beg-dim">{message}</p>}
    </section>
  );
}
