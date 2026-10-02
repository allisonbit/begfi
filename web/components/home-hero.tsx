"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { LINK_ORIGIN, USERNAME_MAX, USERNAME_PATTERN, isReserved } from "@/lib/config";
import { useAuth } from "@/lib/auth-context";
import { useWalletSignIn } from "@/lib/useWalletSignIn";

/**
 * The home page's claim field and its phone preview.
 *
 * They are one component because they are one thing: what you type is what the
 * preview shows. Splitting them would mean lifting the username into a parent
 * that has no other reason to exist.
 *
 * NOTHING HERE IS FAKE. The preview shows the username you typed, a zero, and
 * "no supporters yet" — it does not invent a balance, a supporter count, or an
 * address, and it never claims a link resolves when it does not. The copy button
 * copies the real URL this deployment serves.
 */
type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free" }
  | { state: "taken" }
  | { state: "invalid" }
  | { state: "reserved" }
  | { state: "unknown" };

export function HomeHero() {
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { profile, refresh } = useAuth();
  const { isConnected } = useAccount();
  const { signIn, busy: signingIn } = useWalletSignIn();

  const clean = username.trim().toLowerCase();
  const previewName = clean || "yourname";

  // Debounced availability check. Cancelled on each keystroke so a slow response
  // for an earlier name cannot land after a faster one for the current name and
  // show the wrong answer.
  useEffect(() => {
    if (!clean) {
      setAvailability({ state: "idle" });
      return;
    }
    if (!USERNAME_PATTERN.test(clean)) {
      setAvailability({ state: "invalid" });
      return;
    }
    if (isReserved(clean)) {
      setAvailability({ state: "reserved" });
      return;
    }

    setAvailability({ state: "checking" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username/available?u=${encodeURIComponent(clean)}`, {
          signal: controller.signal,
        });
        const body = (await res.json()) as { available: boolean; reason: string };
        if (body.reason === "taken") setAvailability({ state: "taken" });
        else if (body.available) setAvailability({ state: "free" });
        else setAvailability({ state: "unknown" });
      } catch {
        /* aborted, or offline */
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [clean]);

  const link = useMemo(() => `${LINK_ORIGIN}/${previewName}`, [previewName]);

  const feedback = (() => {
    switch (availability.state) {
      case "checking":
        return <span className="text-beg-dim">Checking…</span>;
      case "free":
        return <span className="text-beg-lime">/{clean} is free</span>;
      case "taken":
        return <span className="text-beg-dim">/{clean} is taken</span>;
      case "reserved":
        return <span className="text-beg-dim">/{clean} is reserved</span>;
      case "invalid":
        return <span className="text-beg-dim">3–20 characters: a–z, 0–9, _</span>;
      case "unknown":
        return <span className="text-beg-dim">Couldn&apos;t check right now</span>;
      default:
        return null;
    }
  })();

  async function copy() {
    try {
      await navigator.clipboard.writeText(`https://${link.replace(/^https?:\/\//, "")}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the link is on screen either way */
    }
  }

  async function claim() {
    setClaimError(null);

    if (!USERNAME_PATTERN.test(clean)) {
      setClaimError("Pick a username first.");
      return;
    }

    // Signed out: establish the session, then come back to finish the claim.
    if (!profile) {
      const { error } = await signIn({ next: `/#claim` });
      if (error) setClaimError(error);
      return;
    }

    setClaiming(true);
    try {
      const res = await fetch("/api/username/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: clean }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!res.ok || !body?.ok) {
        setClaimError(body?.error ?? "Could not claim that username.");
        return;
      }

      setClaimed(clean);
      await refresh();
    } finally {
      setClaiming(false);
    }
  }

  if (profile) {
    return (
      <section id="claim" className="grid items-center gap-9 py-11 md:grid-cols-[1.15fr_.85fr]">
        <div>
          <h1 className="text-[clamp(56px,15vw,150px)] font-extrabold leading-[.82] tracking-[-.06em]">
            You have
            <br />
            <span className="text-beg-lime">a link.</span>
          </h1>
          <p className="my-5 max-w-[26ch] text-xl text-beg-dim">
            Share it and anyone can send you $BEG, straight to your wallet.
          </p>

          <div className="flex max-w-[420px] items-center gap-2 rounded-full border-[1.5px] border-beg-line bg-beg-card py-1.5 pl-[18px] pr-1.5">
            <span className="whitespace-nowrap text-beg-dim">{LINK_ORIGIN.replace(/^https?:\/\//, "")}/</span>
            <span className="flex-1 truncate py-2.5 font-bold text-beg-lime">{profile.username}</span>
            <button
              type="button"
              onClick={copy}
              className="rounded-full bg-beg-lime px-5 py-3 text-[15px] font-bold text-beg-bg"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="mt-2.5 max-w-[46ch] text-[13px] text-beg-dim">
            {claimError ? (
              <span className="text-beg-ink">{claimError}</span>
            ) : (
              <>
                {claimed ? "That's yours. " : null}
                Your profile page is at this address. Sending isn&apos;t live yet — $BEG hasn&apos;t been
                launched.
              </>
            )}
          </p>
        </div>

        <PhonePreview name={profile.username} />
      </section>
    );
  }

  return (
    <section id="claim" className="grid items-center gap-9 py-11 md:grid-cols-[1.15fr_.85fr]">
      <div>
        <h1 className="text-[clamp(56px,15vw,150px)] font-extrabold leading-[.82] tracking-[-.06em]">
          Everyone
          <br />
          <span className="text-beg-lime">begs.</span>
        </h1>
        <p className="my-5 max-w-[26ch] text-xl text-beg-dim">
          Your link. Their $BEG. Straight to your wallet.
        </p>

        <div className="flex max-w-[420px] items-center gap-1.5 rounded-full border-[1.5px] border-beg-line bg-beg-card py-1.5 pl-[18px] pr-1.5 focus-within:border-beg-lime">
          <span className="whitespace-nowrap text-beg-dim">{LINK_ORIGIN.replace(/^https?:\/\//, "")}/</span>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="yourname"
            maxLength={USERNAME_MAX}
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Pick a username"
            className="min-w-0 flex-1 bg-transparent py-2.5 font-bold text-beg-lime outline-none placeholder:text-beg-dim"
          />
          <button
            type="button"
            onClick={claim}
            disabled={claiming || signingIn || availability.state === "taken" || availability.state === "reserved"}
            className="rounded-full bg-beg-lime px-5 py-3 text-[15px] font-bold text-beg-bg disabled:opacity-40"
          >
            {claiming ? "Claiming…" : signingIn ? "Check your wallet…" : isConnected ? "Get your link" : "Connect wallet"}
          </button>
        </div>

        <p className="mt-2.5 min-h-[18px] max-w-[46ch] text-[13px]">
          {claimError ? <span className="text-beg-ink">{claimError}</span> : feedback}
        </p>
      </div>

      <PhonePreview name={previewName} />
    </section>
  );
}

/**
 * A preview of a profile page — not a simulation of one.
 *
 * The zero and "no supporters yet" are the honest empty state of an account that
 * has received nothing, which is what every account looks like on day one. There
 * is no connect button, no balance, and no address, because there is nothing real
 * behind any of them yet.
 */
function PhonePreview({ name }: { name: string }) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[34px] border-[1.5px] border-beg-line bg-beg-card p-5 shadow-[0_0_90px_rgba(204,255,0,.12)]">
      <div className="mb-4 flex justify-between text-xs text-beg-dim">
        <span>Profile preview</span>
        <span>Robinhood Chain</span>
      </div>

      <div className="text-center">
        <div className="mx-auto mb-2.5 grid size-[78px] place-items-center rounded-full bg-beg-lime text-[34px] font-extrabold text-beg-bg">
          {name[0]?.toUpperCase() ?? "Y"}
        </div>
        <b className="block text-[22px]">@{name}</b>
      </div>

      <div className="mb-0.5 mt-4 text-center text-[44px] font-extrabold tracking-[-.04em] text-beg-lime">0</div>
      <div className="mb-4 text-center text-[13px] text-beg-dim">$BEG received · no supporters yet</div>

      <p className="text-center text-[13px] text-beg-dim">
        Illustration only. No account, balance or payment sits behind this, and sends aren&apos;t live.
      </p>
    </div>
  );
}
