"use client";

import { useState } from "react";

/**
 * The campaign "Post & Earn" box.
 *
 * All honesty lives in the disabled reasons: a signed-out visitor sees how to
 * join, a pool-empty campaign says so, and the submit itself reports the
 * server's verdict — including the transient "X didn't answer right now",
 * which the backend deliberately does NOT burn the daily slot for.
 */
export function CampaignSubmitBox({
  slug,
  requiredEntry,
  disabledReason,
  alreadyPostedToday,
  notifyOn,
}: {
  slug: string;
  requiredEntry: string;
  disabledReason?: string | null;
  alreadyPostedToday: boolean;
  notifyOn?: string;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const blocked = Boolean(disabledReason) || alreadyPostedToday || state === "sending";

  async function submit() {
    if (!url.trim()) {
      setError("Paste the link to your post first.");
      return;
    }
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/campaign/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, postUrl: url.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Something went wrong — try again.");
        return;
      }
      setState("done");
      setNotice(`Post accepted and verified — it shares in ${notifyOn ?? "today's"} payout automatically.`);
    } catch {
      setError("Network hiccup — your post was NOT stored. Try again.");
    }
  }

  return (
    <div className="card grid gap-3 p-5">
      <b className="text-[16px] text-beg-ink">Post about this project on X</b>
      <ol className="grid list-decimal gap-1 pl-5 text-[13px] text-beg-dim">
        <li>
          Post on X — your post MUST include <code className="rounded bg-beg-card px-1.5 py-0.5 font-bold text-beg-ink">{requiredEntry}</code>
        </li>
        <li>Paste the post link below</li>
        <li>Get your share of today&apos;s budget automatically — no approval, no claim button</li>
      </ol>

      {alreadyPostedToday ? (
        <p className="notice-dashed">This wallet already posted for this campaign today. Come back after the next cycle to earn again.</p>
      ) : disabledReason ? (
        <p className="notice-dashed">{disabledReason}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setState("idle");
              setError(null);
            }}
            placeholder="https://x.com/you/status/..."
            className="min-w-0 flex-1 rounded-xl border-[1.5px] border-beg-line bg-beg-card px-4 py-2.5 text-[13px] text-beg-ink placeholder:text-beg-dim focus:border-beg-ink focus:outline-none"
            disabled={state === "sending"}
          />
          <button
            type="button"
            onClick={submit}
            disabled={blocked}
            className="rounded-xl border-2 border-beg-ink bg-beg-lime px-5 py-2.5 text-[13px] font-extrabold text-beg-ink transition-opacity disabled:opacity-50"
          >
            {state === "sending" ? "Verifying…" : "Submit & Earn"}
          </button>
        </div>
      )}

      {error && <p className="text-[12px] font-bold text-[#c0392b]">{error}</p>}
      {notice && <p className="text-[12px] font-bold text-beg-ink">{notice}</p>}
      <p className="text-[11px] text-beg-dim">
        One post per wallet per campaign per day. The link must be public and unique — the same link never pays twice. Fake or
        mention-less links are stored with the reason and pay nothing.
      </p>
    </div>
  );
}
