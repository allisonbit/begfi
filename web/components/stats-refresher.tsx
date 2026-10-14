"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the server components — and with them the cached stats reads —
 * on a fixed heartbeats-slow cadence. The interval is 45 seconds, inside
 * the requested 30–60 second window, and comfortably outside every
 * upstream's cache window, so each poll is served by the revalidation
 * cache and never multiplies into rate limits: the page asks its own
 * server, and the server answers from the cache.
 *
 * Navigating away must stop the timer; that is what this component's
 * life cycle gives for free — it never mounts on other pages.
 */
/**
 * The same timer under a name that says why it exists: feeds and pages that
 * want to visibly move (the activity feed polls every 15 seconds through the
 * same router-refresh mechanics — the server answers from its own caches, so
 * "live" costs nothing downstream).
 */
export const LiveRefresher = StatsRefresher;

export function StatsRefresher({ intervalMs = 45_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
