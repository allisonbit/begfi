"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseAmount, formatAmount } from "@/lib/erc20";

/**
 * Open a beg-to-launch ask.
 *
 * One form, three fields, and an honesty line doing the heavy lifting: the
 * money supporters send goes wallet to wallet and BegFi never touches it, so
 * nothing here "escrows" a goal or "returns" funds. The goal is a target the
 * ask is measured against, and only a real, chain-verified launch closes it.
 */
export function LaunchBegForm() {
  const router = useRouter();
  const [tokenName, setTokenName] = useState("");
  const [tokenTicker, setTokenTicker] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanGoal = goal.trim() ? parseAmount(goal) : null;
  const goalOk = cleanGoal !== null && cleanGoal > 0n;

  async function submit() {
    setError(null);
    if (!tokenName.trim()) return setError("Name the token you want to launch.");
    if (!/^[A-Z0-9]{2,10}$/.test(tokenTicker.trim().toUpperCase())) {
      return setError("The ticker is 2 to 10 letters or digits.");
    }
    if (!oneLiner.trim()) return setError("Say in one line what supporters are funding.");
    if (!goalOk) return setError("Set a $BEG goal supporters can see progress toward.");

    setBusy(true);
    try {
      const res = await fetch("/api/launch-beg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          tokenName: tokenName.trim(),
          tokenTicker: tokenTicker.trim().toUpperCase(),
          oneLiner: oneLiner.trim(),
          goal: cleanGoal!.toString(),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Couldn't open the beg. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime";

  return (
    <section className="card grid gap-3 p-5">
      <div>
        <b className="text-[16px] text-beg-ink">Beg to launch</b>
        <p className="mt-1 text-[13px] text-beg-dim">
          Ask supporters to send $BEG toward your launch. Sends go wallet to wallet; BegFi never
          holds them and cannot return them.
        </p>
      </div>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Token name</span>
        <input value={tokenName} onChange={(e) => setTokenName(e.target.value)} maxLength={32} className={field} placeholder="BegFi" />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Ticker</span>
        <input
          value={tokenTicker}
          onChange={(e) => setTokenTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          maxLength={10}
          className={field}
          placeholder="BEG"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">One line on why</span>
        <textarea
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          rows={2}
          maxLength={180}
          className={field}
          placeholder="What the token is for, in one sentence."
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Goal, in $BEG</span>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className={field}
          placeholder="1000000"
        />
        {goal.trim() !== "" && goalOk ? (
          <span className="text-[12px] text-beg-dim">{formatAmount(cleanGoal!)} $BEG</span>
        ) : goal.trim() !== "" ? (
          <span className="text-[12px] text-beg-ink">Not a valid amount.</span>
        ) : null}
      </label>

      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      <button type="button" onClick={() => void submit()} disabled={busy} className="btn-primary">
        {busy ? "Opening…" : "Open the beg"}
      </button>
      <p className="text-[12px] text-beg-dim">
        One open ask at a time. It closes the moment you actually launch, which the site verifies
        on-chain.
      </p>
    </section>
  );
}
