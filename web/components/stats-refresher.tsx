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
export function StatsRefresher({ intervalMs = 45_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
