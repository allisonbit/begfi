"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { track } from "@/lib/analytics";
import { parseAmount } from "@/lib/erc20";

/** The four asks that cover most of what a payment link is actually for. */
const PRESETS = ["5", "20", "100", "500"] as const;

/**
 * Create a pay request.
 *
 * THE AMOUNT IS VALIDATED HERE THE SAME WAY IT IS ON THE SERVER, with the same
 * `parseAmount`, so the error a person sees is about what they typed rather than
 * about a round trip. The server re-parses regardless — a client check is a
 * courtesy, never a control.
 *
 * BOTH FIELDS ARE OPTIONAL. A blank amount means "any amount" and a blank memo
 * means the page falls back to its own headline; neither is a validation error,
 * because "pay me something for the thing I did" is a legitimate request and
 * demanding a number would refuse it.
 */
export function PayLinkForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const parsed = amount.trim() === "" ? null : parseAmount(amount);
  const amountInvalid = amount.trim() !== "" && parsed === null;

  async function create() {
    setError(null);

    if (amountInvalid) {
      setError("That amount doesn't look like a number.");
      return;
    }
    if (parsed !== null && parsed <= 0n) {
      setError("An ask of zero isn't an ask.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amount.trim() || null, memo: memo.trim() || null }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: string; error?: string }
        | null;

      if (!res.ok || !body?.ok || !body.id) {
        setError(body?.error ?? "Couldn't create that request.");
        return;
      }

      track("pay_link_created", { has_amount: parsed !== null });
      setCreated(body.id);
      setAmount("");
      setMemo("");
      // The list below is server-rendered, so it has to be re-fetched to show
      // the new row — the same pattern the campaign form uses.
      router.refresh();
    } catch {
      setError("Network problem — nothing was created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">How much are you asking for? (optional)</span>
        {/*
          PRESETS ARE THE POINT OF A PAYMENT LINK. Typing a number is the slow
          part of asking; four amounts cover most tips and the custom field
          stays for everything else. Selecting a preset fills the SAME input
          the person can edit, so there is one source of truth for the amount
          and no second parser to disagree with the first.
        */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Amount presets">
          {PRESETS.map((preset) => {
            const on = amount === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setAmount(on ? "" : preset);
                  setError(null);
                }}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
                  on
                    ? "border-beg-ink bg-beg-lime text-beg-ink"
                    : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
                }`}
              >
                {preset}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={amount === ""}
            onClick={() => {
              setAmount("");
              setError(null);
            }}
            className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
              amount === ""
                ? "border-beg-ink bg-beg-lime text-beg-ink"
                : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
            }`}
          >
            Any amount
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 focus-within:border-beg-lime">
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^0-9.,]/g, ""));
              setError(null);
            }}
            inputMode="decimal"
            placeholder="20"
            className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim"
          />
          <span className="text-[13px] font-bold text-beg-dim">$BEGFI</span>
        </div>
        <span className="text-[12px] text-beg-dim">
          Leave it blank to ask for any amount — the link still works, without a number on it.
        </span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">What is it for? (optional)</span>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value.slice(0, 90))}
          placeholder="Lunch money"
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-[16px] text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className={`text-right text-[12px] ${memo.length >= 90 ? "font-bold text-beg-ink" : "text-beg-dim"}`}>
          {memo.length}/90
        </span>
      </label>

      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      {/*
        Only `busy` disables the button. A disabled button on an invalid amount
        would make the validation message unreachable — the person would see a
        dead button and no reason for it.
      */}
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className="btn-primary p-4 text-[16px] disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create request link"}
      </button>

      {created ? (
        <div className="rounded-2xl border-[1.5px] border-beg-lime p-4">
          <p className="w-fit rounded-md bg-beg-lime px-1.5 py-0.5 text-[13px] font-bold text-beg-ink">
            Your request is live
          </p>
          <p className="mt-2 text-[13px] text-beg-dim">
            Share it and the amount travels with the text.
          </p>
          <Link
            href={`/pay/${created}`}
            className="mt-2 inline-block text-[14px] font-bold text-beg-ink underline decoration-beg-lime decoration-2 underline-offset-2"
          >
            Open the request page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
