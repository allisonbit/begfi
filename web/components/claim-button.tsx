"use client";

import { useState } from "react";

/**
 * The manual Claim button.
 *
 * Manual on purpose: approving pays nothing yet, so the wallet signature for
 * the payout is not "bulk" — a person decides when their money moves, and the
 * button is disabled — not hidden — when there is nothing to claim, because a
 * missing button looks like a broken page.
 */
export function ClaimButton({ claimableDisplay, payoutConfigured }: { claimableDisplay: string; payoutConfigured: boolean }) {
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paid, setPaid] = useState<string | null>(null);

  const nothingToClaim = claimableDisplay === "0";

  async function claim() {
    setMessage(null);
    setClaiming(true);
    try {
      const res = await fetch("/api/earn/claim", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; tx?: string }
        | null;

      if (res.ok && body?.ok && body.tx) {
        setPaid(body.tx);
        setMessage("Claimed — the $BEGFI is on its way.");
      } else {
        setMessage(body?.error ?? "Could not claim right now.");
      }
    } catch {
      setMessage("Network hiccup — try again.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => void claim()}
        disabled={claiming || nothingToClaim}
        className="btn-primary px-5 py-3 text-[14px] disabled:opacity-40"
      >
        {claiming ? "Claiming…" : nothingToClaim ? "Nothing to claim yet" : "Claim"}
      </button>
      {!payoutConfigured && !nothingToClaim ? (
        <p className="text-[12px] text-beg-dim">Payout wallet is not wired yet — claims wait until it is.</p>
      ) : null}
      {message ? (
        <p className="text-[12px] text-beg-dim">
          {message}
          {paid ? (
            <>
              {" "}
              <a href={`https://robinhoodchain.blockscout.com/tx/${paid}`} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-beg-ink">
                View on explorer ↗
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
