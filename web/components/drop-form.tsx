"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * START A DROP.
 *
 * The form's job is to collect the SIX facts a drop is defined by — name, token,
 * prize, cap, description, deadline — and to say what will happen next. Two of
 * those are not free text: the prize is a decimal amount converted against the
 * token's OWN decimals by the server (a 6-decimal token read as 18 pays a
 * prize a trillionth of the size advertised), and the token's exclusivity is
 * decided by the database's lease: one token can fund one live pool at a time.
 * Both refusals come back as sentences from the API and are shown verbatim.
 *
 * THE FORM DOES NOT ASK FOR A DEPOSIT AMOUNT. Funding is a separate, deliberate
 * step on the drop's own page — register the intent, then send — because a
 * creation form that also took money would make an accidental click an
 * accidental deposit.
 */
export function DropForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [fields, setFields] = useState({
    name: "",
    description: "",
    tokenName: "",
    tokenSymbol: "",
    tokenAddress: "",
    amountPerClaimDisplay: "",
    maxClaims: "25",
    closesAt: "",
  });

  const set = (key: keyof typeof fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/drop/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; id?: string } | null;
      if (res.ok && body?.ok) {
        setCreated(body.id ?? null);
        setFields({
          name: "",
          description: "",
          tokenName: "",
          tokenSymbol: "",
          tokenAddress: "",
          amountPerClaimDisplay: "",
          maxClaims: "25",
          closesAt: "",
        });
        setOpen(false);
        router.refresh();
      } else {
        setError(body?.error ?? "Could not create the drop.");
      }
    } catch {
      setError("Network problem — nothing was created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="grid gap-2">
        <button type="button" onClick={() => setOpen(true)} className="btn-primary w-fit px-5 py-3 text-[14px]">
          Start a drop
        </button>
        {created ? (
          <p className="text-[12px] text-beg-dim">
            Drop created. Open it to fund the pot —{" "}
            <a href={`/drop/${created}`} className="underline underline-offset-2 hover:text-beg-ink">
              /drop/{created.slice(0, 8)}…
            </a>
          </p>
        ) : null}
        {error ? <p className="text-[13px] font-bold text-beg-ink">{error}</p> : null}
      </div>
    );
  }

  return (
    <section className="card grid gap-3">
      <b className="text-[16px] text-beg-ink">Start a drop</b>
      <p className="text-[12px] text-beg-dim">
        One token, one prize, a cap on winners. You fund the pot after creating it; nothing is spent here.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Drop name" value={fields.name} onChange={set("name")} placeholder="Friday $DOGE giveaway" />
        <Field
          label="Prize per claim"
          value={fields.amountPerClaimDisplay}
          onChange={set("amountPerClaimDisplay")}
          placeholder="500"
          hint="In the token's own units."
        />
        <Field label="Token name" value={fields.tokenName} onChange={set("tokenName")} placeholder="Doge" />
        <Field label="Token symbol" value={fields.tokenSymbol} onChange={set("tokenSymbol")} placeholder="DOGE" />
        <div className="sm:col-span-2">
          <Field
            label="Token contract address"
            value={fields.tokenAddress}
            onChange={set("tokenAddress")}
            placeholder="0x…"
            mono
            hint="A token can only fund one live pool at a time — that is what keeps every deposit attributable."
          />
        </div>
        <Field label="How many winners" value={fields.maxClaims} onChange={set("maxClaims")} placeholder="25" />
        <label className="grid gap-1">
          <span className="text-[12px] font-bold text-beg-ink">Closes (optional)</span>
          <input
            type="datetime-local"
            value={fields.closesAt}
            onChange={(e) => set("closesAt")(e.target.value)}
            className="rounded-full border-2 border-beg-ink bg-beg-card px-4 py-2.5 text-[13px] font-bold text-beg-ink outline-none"
          />
          <span className="text-[11px] text-beg-dim">Leave empty to run until the prizes run out.</span>
        </label>
        <div className="sm:col-span-2">
          <Field
            label="Description (optional)"
            value={fields.description}
            onChange={set("description")}
            placeholder="Why the drop exists, in a line."
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy} className="btn-primary px-5 py-3 text-[14px]">
          {busy ? "Creating…" : "Create the drop"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-4 py-3 text-[13px] font-bold text-beg-ink">
          Cancel
        </button>
      </div>

      {error ? <p className="text-[13px] font-bold text-beg-ink">{error}</p> : null}
      <p className="text-[11px] text-beg-dim">
        The prize is fixed at creation: a claim is a promise made at a moment, and the claim row carries the number it was made for.
        A different prize is a different drop.
      </p>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] font-bold text-beg-ink">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`rounded-full border-2 border-beg-ink bg-beg-card px-4 py-2.5 text-[13px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim ${
          mono ? "font-mono text-[12px]" : ""
        }`}
      />
      {hint ? <span className="text-[11px] text-beg-dim">{hint}</span> : null}
    </label>
  );
}
