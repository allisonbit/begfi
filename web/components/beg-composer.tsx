"use client";

import { useState } from "react";
import { ShareButtons } from "@/components/share-buttons";

/**
 * Write a beg, get a shareable link.
 *
 * This is the feature in one component: type what you're asking for, press once,
 * and the result is a link that carries its own image. Sharing it to X or
 * Telegram shows the words; clicking it opens the page with the wallet on it.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; id: string } | null>(null);

  async function create() {
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/beg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: string; error?: string }
        | null;

      if (!res.ok || !result?.ok || !result.id) {
        setError(result?.error ?? "Couldn't create that.");
        return;
      }

      setShare({ url: `${window.location.origin}/beg/${result.id}`, id: result.id });
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
          <p className="text-[13px] font-bold text-beg-lime">Your beg is live</p>
          <p className="mt-2 text-[15px] text-beg-ink">{body}</p>
        </div>

        <ShareButtons url={share.url} text={body} />

        <button
          type="button"
          onClick={() => {
            setShare(null);
            setBody("");
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
        <span className={`text-right text-[12px] ${body.length > MAX - 20 ? "text-beg-lime" : "text-beg-dim"}`}>
          {body.length}/{MAX}
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
        className="rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg disabled:opacity-40"
      >
        {busy ? "Making your link…" : "Make my beg link"}
      </button>

      <p className="text-[12px] text-beg-dim">
        You get a link with its own image. Post it anywhere and it shows your words.
      </p>
    </div>
  );
}
