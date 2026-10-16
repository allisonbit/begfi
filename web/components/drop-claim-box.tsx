"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { track } from "@/lib/analytics";
import { txUrl } from "@/lib/chains";

/**
 * The claim button, in the five states a claim actually has.
 *
 * The SERVER decides which state is true — signed out, no username, claimable,
 * already claimed (yours), not claimable — because every one of those facts is
 * a database read the client must not be trusted to guess. The client's job is
 * to render that state and to post one claim; the server's answer, including
 * its refusals, is shown verbatim.
 *
 * AFTER A CLAIM, the prize is sent by the same sweep the cron uses, fired by
 * the claim itself. So the box says "on its way", offers a check, and refreshes
 * the page after a short wait — the row's own `payout_tx` is what flips it to
 * "paid", not this component's optimism.
 */
export type ClaimBoxState =
  | { kind: "signed-out" }
  | { kind: "no-username" }
  | { kind: "claimed"; payoutTx: string | null }
  | { kind: "claimable" }
  | { kind: "unavailable"; reason: string };

export function DropClaimBox({
  dropId,
  prizeDisplay,
  symbol,
  state,
}: {
  dropId: string;
  prizeDisplay: string;
  symbol: string;
  state: ClaimBoxState;
}) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState(false);

  async function claim() {
    setError(null);
    setMessage(null);
    setClaiming(true);
    try {
      const res = await fetch("/api/drop/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setJustClaimed(true);
        setMessage(`Claimed — ${prizeDisplay} ${symbol} is being sent to your wallet now.`);
        track("campaign_joined");
        // The sweep runs right after the claim; give it a moment, then re-read
        // the page so the winners list and the payout hash catch up.
        window.setTimeout(() => router.refresh(), 9_000);
      } else {
        setError(body?.error ?? "Could not record the claim. Try again.");
      }
    } catch {
      setError("Network problem — the claim did not go through. Retry.");
    } finally {
      setClaiming(false);
    }
  }

  if (state.kind === "signed-out") {
    return (
      <div className="grid gap-2">
        <b className="text-[15px] text-beg-ink">
          {prizeDisplay} {symbol} per claim
        </b>
        <p className="text-[13px] text-beg-dim">Sign in with the wallet that should receive the prize — a free signature, no gas.</p>
        <a href="#claim-sign-in" className="btn-primary w-fit px-5 py-3 text-[14px]">
          Sign in to claim
        </a>
      </div>
    );
  }

  if (state.kind === "no-username") {
    return (
      <div className="grid gap-2">
        <b className="text-[15px] text-beg-ink">Claim a username to take a prize</b>
        <p className="text-[13px] text-beg-dim">
          Prizes are paid to the wallet you signed in with. A username is how the winners list can name you.
        </p>
        <a href="/#claim" className="btn-primary w-fit px-5 py-3 text-[14px]">
          Pick a username
        </a>
      </div>
    );
  }

  if (state.kind === "claimed" || justClaimed) {
    const payoutTx = state.kind === "claimed" ? state.payoutTx : null;
    return (
      <div className="grid gap-2">
        <b className="text-[15px] text-beg-ink">{payoutTx ? "Prize paid 🎉" : "Your prize is on its way"}</b>
        <p className="text-[13px] text-beg-dim">
          {payoutTx ? (
            <>
              The transfer is confirmed on-chain.{" "}
              <a href={txUrl(payoutTx)} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-beg-ink">
                View it on the explorer ↗
              </a>
            </>
          ) : (
            "It is sent to your wallet automatically within a moment — this page updates itself when the transfer confirms."
          )}
        </p>
        {!payoutTx ? (
          <button type="button" onClick={() => router.refresh()} className="btn-ghost w-fit px-4 py-2 text-[13px] font-bold text-beg-ink">
            Check again
          </button>
        ) : null}
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="grid gap-2">
        <b className="text-[15px] text-beg-ink">
          {prizeDisplay} {symbol} per claim
        </b>
        <p className="text-[13px] text-beg-dim">{state.reason}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <b className="text-[15px] text-beg-ink">
        {prizeDisplay} {symbol} — yours if you are quick
      </b>
      <button type="button" onClick={() => void claim()} disabled={claiming} className="btn-primary w-fit px-6 py-3 text-[15px]">
        {claiming ? "Claiming…" : "Claim my prize"}
      </button>
      {message ? <p className="text-[13px] font-bold text-beg-ink">{message}</p> : null}
      {error ? <p className="text-[13px] font-bold text-beg-ink">{error}</p> : null}
      <p className="text-[12px] text-beg-dim">One prize per wallet, and one per verified X account. The transfer is automatic.</p>
    </div>
  );
}
