"use client";

import { useEffect, useState } from "react";

/**
 * The countdown to the weekly reset (Monday 00:00 UTC).
 *
 * Server-rendered text would freeze at "renders in Xh" until hydration
 * anyway, so the component renders its first honest frame immediately from
 * the client clock: a suppressed dash until mounted, then a live ticking
 * countdown. One interval, cleared on unmount.
 */
export function BattleCountdown({ endsAtIso }: { endsAtIso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) {
    return <span className="text-[13px] font-bold text-beg-dim">resets Monday 00:00 UTC</span>;
  }

  const ms = Math.max(0, new Date(endsAtIso).getTime() - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);

  const label =
    days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;

  return (
    <span className="text-[13px] font-bold text-beg-ink" suppressHydrationWarning>
      resets in {label}
    </span>
  );
}
