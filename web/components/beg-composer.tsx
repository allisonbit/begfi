"use client";

import { useState } from "react";
import { ShareButtons } from "@/components/share-buttons";
import { formatAmount, parseAmount } from "@/lib/erc20";

/**
 * Write a beg, get a shareable link.
 *
 * This is the feature in one component: type what you're asking for, optionally
 * how much you need, press once, and the result is a link that carries its own
 * image. Sharing it to X or Telegram shows the words; clicking it opens the page
 * with the wallet on it.
 *
 * Sized honestly — 180 characters, counted on screen. The generated image lays
 * text out at a fixed size, so a message that overflows would be clipped in the
 * picture rather than wrapped, and a clipped beg is a worse advert than a short
 * one. The limit is the image's, not the database's.
 */
const MAX = 180;

const STARTERS = [
  "I'm begging for a new laptop so I can keep building.",
  "Help me get to the fight in March.",
  "I'm begging for rent this month. Anything helps.",
];

export function BegComposer() {
  const [body, setBody] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; id: string; goal: string | null } | null>(null);

  /*
   * The amount is optional and parsed strictly. `parseAmount` returns null for
   * anything it does not fully understand, and the field is rejected rather than
   * coerced — a goal of "1,0oo" silently becoming 100 would set someone's target
   * to a number they never typed, on a page they then share.
   */
  const goalWei = goal.trim() === "" ? null : parseAmount(goal);
  const goalInvalid = goal.trim() !== "" && goalWei === null;
  const goalZero = goalWei === 0n;

  async function create() {
    setError(null);

    if (goalInvalid) return setError("That amount doesn't look like a number.");
    if (goalZero) return setError("A goal of zero isn't a goal.");

    setBusy(true);
    try {
      const res = await fetch("/api/beg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, goal: goalWei === null ? null : goalWei.toString() }),
      });
      const result = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: string; error?: string }
        | null;

      if (!res.ok || !result?.ok || !result.id) {
        setError(result?.error ?? "Couldn't create that.");
        return;
      }

      setShare({
        url: `${window.location.origin}/beg/${result.id}`,
        id: result.id,
        goal: goalWei === null ? null : formatAmount(goalWei),
      });
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (share) {
    return (
      <div className="grid gap-5">
        <div className="rounded-3xl border-[1.5px] border-beg-lime p-5">
          <p className="w-fit rounded-md bg-beg-lime px-1.5 py-0.5 text-[13px] font-bold text-beg-ink">Your beg is live</p>
          <p className="mt-2 text-[15px] text-beg-ink">{body}</p>
          {share.goal ? (
            <p className="mt-2 text-[13px] text-beg-dim">Asking for {share.goal} $BEG</p>
          ) : null}
        </div>

        <ShareButtons url={share.url} text={body} />

        <button
          type="button"
          onClick={() => {
            setShare(null);
            setBody("");
            setGoal("");
          }}
          className="rounded-full border-[1.5px] border-beg-line p-3 text-[13px] font-bold text-beg-dim transition-colors hover:border-beg-lime hover:text-beg-ink"
        >
          Write another
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">What are you begging for?</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder="I'm begging for…"
          className="resize-none rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-4 text-[16px] text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className={`text-right text-[12px] ${body.length > MAX - 20 ? "rounded-md bg-beg-lime px-1 font-bold text-beg-ink" : "text-beg-dim"}`}>
          {body.length}/{MAX}
        </span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">How much do you need? (optional)</span>
        <div className="flex items-center gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 focus-within:border-beg-lime">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            placeholder="1000"
            className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim"
          />
          <span className="text-[13px] font-bold text-beg-dim">$BEG</span>
        </div>
        <span className="text-[12px] text-beg-dim">
          Set a target and your page shows how far along you are. Leave it blank to beg open endedly.
        </span>
      </label>

      {body.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => setBody(starter)}
              className="rounded-full border-[1.5px] border-beg-line px-3 py-1.5 text-left text-[12px] text-beg-dim transition-colors hover:border-beg-lime hover:text-beg-ink"
            >
              {starter.slice(0, 32)}…
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || body.trim().length === 0}
        className="rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-ink disabled:opacity-40"
      >
        {busy ? "Making your link…" : "Make my beg link"}
      </button>

      <p className="text-[12px] text-beg-dim">
        You get a link with its own image. Post it anywhere and it shows your words.
      </p>
    </div>
  );
}
