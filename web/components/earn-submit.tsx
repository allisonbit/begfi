"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useWalletSignIn } from "@/lib/useWalletSignIn";

/**
 * The Earn submit box, in exactly three states.
 *
 * The spec's table is the API: logged out ("Log in to start earning" + the
 * wallet button), logged in without a username ("Set your username to start
 * earning" + a link to Edit profile), and ready (link input + submit). The
 * state comes from the session, never from what the visitor typed, so a
 * half-made account cannot see a box that would not accept anything.
 *
 * Client-side checks mirror the server's, for instant feedback. The server's
 * word is final — a "should have passed" submission that the client accepted
 * and the API rejects still shows the API's error verbatim.
 */
export function EarnSubmitBox({
  disabledReason,
  remainingToday,
  dailyLimit,
}: {
  /** When set (pool empty, earn paused, payouts off), the box is disabled with this copy. */
  disabledReason: string | null;
  remainingToday: number;
  dailyLimit: number;
}) {
  const { profile } = useAuth();
  const { signIn, busy: signingIn, error: signInError } = useWalletSignIn();

  const [postUrl, setPostUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [remaining, setRemaining] = useState(remainingToday);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    setRemaining(remainingToday);
  }, [remainingToday]);

  /*
   * The device fingerprint, computed once per mount. Coarse ON PURPOSE —
   * screen size, language, time zone, platform, and a canvas hash — because
   * the goal is "one device", not surveillance. It is hashed with a server
   * pepper before it is stored, so the site holds a tag that only means
   * "this same browser came back today" and nothing more personal.
   *
   * localStorage remembers it so it stays stable across visits to the same
   * browser: a refresh that yields a different canvas hash (some GPUs vary)
   * would still rate-limit as the same device.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = localStorage.getItem("begfi-earn-fp");
        if (stored) {
          setFingerprint(stored);
          return;
        }
        const canvasEl = document.createElement("canvas");
        const ctx = canvasEl.getContext("2d");
        ctx?.fillText("begfi_fp", 2, 2);
        const parts = [
          navigator.language,
          Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
          `${screen.width}x${screen.height}x${screen.colorDepth}`,
          navigator.platform ?? "",
          canvasEl.toDataURL().slice(-64) || "nocanvas",
        ].join("|");
        if (!cancelled) {
          localStorage.setItem("begfi-earn-fp", parts);
          setFingerprint(parts);
        }
      } catch {
        /* no fingerprint: the device limit falls back to "no-fp", which is
           itself capped, and the IP limit still applies. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) {
    return (          <section className="card grid justify-items-center gap-2 p-6 text-center">
        <b className="text-[18px] text-beg-ink">Log in to start earning</b>
        <p className="max-w-[40ch] text-[13px] text-beg-dim">Wallet connects, one signature, and the submit box appears.</p>
        <button type="button" onClick={() => void signIn()} disabled={signingIn} className="btn-primary px-6 py-3 text-[15px]">
          {signingIn ? "Check your wallet…" : "Connect wallet / Log in"}
        </button>
        {signInError ? <p className="max-w-[46ch] text-[13px] text-beg-dim">{signInError}</p> : null}
      </section>
    );
  }

  if (!profile.username) {
    return (
      <section className="card grid justify-items-center gap-2 p-6 text-center">
        <b className="text-[18px] text-beg-ink">Set your username to start earning</b>
        <p className="text-[13px] text-beg-dim">Payouts go to your wallet, credited under your link.</p>
        <a href="/dashboard/profile" className="btn-primary px-6 py-3 text-[15px]">
          Set username
        </a>
      </section>
    );
  }

  const blocked = disabledReason !== null || remaining <= 0;
  const looksValid = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/\S+\/status\/\d+/i.test(postUrl.trim());

  async function submit() {
    setMessage(null);
    if (!looksValid) {
      setMessage("That is not an X post link. Paste a x.com/twitter.com status URL.");
      setMessageKind("error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/earn/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post_url: postUrl.trim(), fp: fingerprint ?? "" }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; remaining?: number } | null;

      if (res.ok && body?.ok) {
        setMessage("Submitted! Pending review.");
        setMessageKind("info");
        setPostUrl("");
        if (typeof body.remaining === "number") setRemaining(body.remaining);
      } else {
        setMessage(body?.error ?? "Could not submit right now.");
        setMessageKind("error");
      }
    } catch {
      setMessage("Network hiccup — try again.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card grid gap-3 p-6">
      <div className="flex items-baseline justify-between">
        <b className="text-[18px] text-beg-ink">Drop your post link</b>
        <span className="text-[12px] text-beg-dim">
          {remaining} of {dailyLimit} submissions left today
        </span>
      </div>

      <div className="grid gap-2 rounded-3xl border-2 border-dashed border-beg-line bg-beg-card p-3 sm:flex sm:rounded-full sm:py-2 sm:pl-[18px] sm:pr-2">
        <input
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          placeholder="Paste your X post link"
          inputMode="url"
          spellCheck={false}
          disabled={blocked}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim disabled:opacity-40"
        />
        <button type="button" onClick={() => void submit()} disabled={blocked || submitting} className="btn-primary max-sm:justify-self-stretch max-sm:px-4 max-sm:py-2.5 max-sm:text-[13px] sm:px-5 sm:py-3 sm:text-[14px]">
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      {message ? (
        <p className="text-[13px] font-bold text-beg-ink">
          {messageKind === "info" ? (
            <span className="rounded-md bg-beg-lime px-1.5 py-0.5">{message}</span>
          ) : (
            message
          )}
        </p>
      ) : (
        <p className="text-[13px] text-beg-dim">
          {disabledReason ?? "Submitting starts the payout automatically — the $BEGFI is sent to your wallet. One post a day."}
        </p>
      )}
    </section>
  );
}
