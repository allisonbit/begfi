"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The watchlist star, on Explore cards and the token page.
 *
 * Optimistic on the client, honest about failure: the fill flips immediately
 * so the tap feels instant, and a failed request rolls the state back and
 * says so instead of leaving the star in a state the database does not agree
 * with. Signed-out visitors get a link to sign in rather than a button that
 * silently does nothing.
 */
export function WatchStar({
  tokenAddress,
  initialWatched,
  signedIn,
  size = "sm",
}: {
  tokenAddress: string;
  initialWatched: boolean;
  signedIn: boolean;
  size?: "sm" | "lg";
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (!signedIn) {
    return (
      <a
        href="/dashboard"
        title="Sign in to watch this token"
        aria-label="Sign in to watch this token"
        className={`inline-grid shrink-0 place-items-center rounded-full border-[1.5px] border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink ${
          size === "lg" ? "size-9" : "size-7"
        }`}
      >
        <svg viewBox="0 0 24 24" width={size === "lg" ? 18 : 14} height={size === "lg" ? 18 : 14} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2.6l2.9 5.9 6.5 1-4.7 4.5 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-1z" />
        </svg>
      </a>
    );
  }

  async function toggle() {
    const next = !watched;
    setWatched(next);
    setFailed(false);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle", tokenAddress, watched: next }),
      });
      if (!res.ok) throw new Error();
      startTransition(() => router.refresh());
    } catch {
      setWatched(!next);
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={watched}
      title={failed ? "Couldn't save; try again" : watched ? "Watching: click to remove" : "Watch this token"}
      className={`inline-grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors ${
        failed
          ? "border-beg-ink bg-beg-yellow text-beg-ink"
          : watched
            ? "border-beg-ink bg-beg-lime text-beg-ink"
            : "border-beg-line bg-beg-card text-beg-dim hover:border-beg-ink hover:text-beg-ink"
      } ${size === "lg" ? "size-9" : "size-7"}`}
    >
      <svg
        viewBox="0 0 24 24"
        width={size === "lg" ? 18 : 14}
        height={size === "lg" ? 18 : 14}
        fill={watched ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M12 2.6l2.9 5.9 6.5 1-4.7 4.5 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-1z" />
      </svg>
    </button>
  );
}
