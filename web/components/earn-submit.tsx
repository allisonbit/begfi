"use client";

import { useState } from "react";
import { ClaimCard } from "@/components/claim-card";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useWalletSignIn } from "@/lib/useWalletSignIn";

/**
 * The Earn submit box, in exactly four states.
 *
 * The spec's table is the API: logged out ("Log in to start earning" + the
 * wallet button), logged in without a username ("Set your username to start
 * earning" + a link to Edit profile), ready (link input + submit), and
 * already claimed (the wallet's one-time record says so — the box says so,
 * without a disabled input pretending more submissions exist).
 *
 * Client-side checks mirror the server's, for instant feedback. The server's
 * word is final — a "should have passed" submission that the client accepted
 * and the API rejects still shows the API's error verbatim.
 */
export function EarnSubmitBox({ disabledReason }: { disabledReason: string | null }) {
  const { profile } = useAuth();
  const { signIn, busy: signingIn, error: signInError } = useWalletSignIn();

  const [postUrl, setPostUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [cardAmount, setCardAmount] = useState<string | null>(null);

  if (!profile) {
    return (
      <section className="card grid justify-items-center gap-2 p-6 text-center">
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

  const blocked = disabledReason !== null;
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
        body: JSON.stringify({ post_url: postUrl.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; reward?: string }
        | null;

      if (res.ok && body?.ok) {
        const rewardText = body.reward
          ? (BigInt(body.reward) / 10n ** 18n).toLocaleString("en-GB")
          : "10,000";
        setCardAmount(rewardText);
        setMessage(null);
        setPostUrl("");
        track("campaign_joined");
      } else {
        setMessage(body?.error ?? "Something went wrong. Try again.");
        setMessageKind("error");
      }
    } catch {
      setMessage("Network problem — the submission did not go through. Retry.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }

  if (cardAmount && profile) {
    return (
      <>
        <ClaimCard amount={cardAmount} username={profile.username} onClose={() => setCardAmount(null)} />
        {/* Keep the submit box mounted underneath so a closed card reveals it. */}
        <SubmitForm
          postUrl={postUrl}
          setPostUrl={setPostUrl}
          submitting={submitting}
          message={message}
          messageKind={messageKind}
          blocked={blocked}
          disabledReason={disabledReason}
          looksValid={looksValid}
          onSubmit={() => void submit()}
        />
      </>
    );
  }

  return (
    <SubmitForm
      postUrl={postUrl}
      setPostUrl={setPostUrl}
      submitting={submitting}
      message={message}
      messageKind={messageKind}
      blocked={blocked}
      disabledReason={disabledReason}
      looksValid={looksValid}
      onSubmit={() => void submit()}
    />
  );
}

type SubmitFormProps = {
  postUrl: string;
  setPostUrl: (v: string) => void;
  submitting: boolean;
  message: string | null;
  messageKind: "info" | "error";
  blocked: boolean;
  disabledReason: string | null;
  looksValid: boolean;
  onSubmit: () => void;
};

/** The form proper, stripped of the auth states handled above. */
function SubmitForm({ postUrl, setPostUrl, submitting, message, messageKind, blocked, disabledReason, looksValid, onSubmit }: SubmitFormProps) {
  return (
    <section className="card grid gap-3 p-6">
      <div className="flex items-baseline justify-between">
        <b className="text-[18px] text-beg-ink">Drop your post link</b>
        <span className="text-[12px] text-beg-dim">one claim per wallet, ever</span>
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
        <button type="button" onClick={onSubmit} disabled={blocked || submitting} className="btn-primary max-sm:justify-self-stretch max-sm:px-4 max-sm:py-2.5 max-sm:text-[13px] sm:px-5 sm:py-3 sm:text-[14px]">
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      {message ? (
        <p className="grid gap-1.5 text-[13px] font-bold text-beg-ink">
          {messageKind === "error" && (message === "Network problem — the submission did not go through. Retry." || message.startsWith("Could not")) ? (
            <>
              <span>{message}</span>
              <button type="button" onClick={onSubmit} disabled={submitting} className="btn-ghost w-fit justify-self-start px-4 py-2 text-[12px] font-bold text-beg-ink">
                {submitting ? "Retrying…" : "Retry"}
              </button>
            </>
          ) : (
            <span>{message}</span>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-beg-dim">
          {disabledReason ?? "Submitting pays automatically — the $BEGFI is sent to your wallet once, ever."}
        </p>
      )}
    </section>
  );
}
