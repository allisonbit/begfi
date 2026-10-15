"use client";

import { useEffect, useState } from "react";

/**
 * Countdown to the next automatic payout.
 *
 * The sweep serves each campaign at 04:41 UTC daily; the countdown points at
 * that one moment so "when do I get paid" has a single honest answer, and
 * ticks itself with a 1s interval once mounted (a server component cannot
 * count for the same reason it cannot know how long a user's coffee break is).
 */
export function CampaignCountdown({ hourUtc = 4, minuteUtc = 43 }: { hourUtc?: number; minuteUtc?: number }) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const next = new Date();
    next.setUTCHours(hourUtc, minuteUtc, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);

    const tick = () => {
      const remain = Math.max(0, next.getTime() - Date.now());
      setMs(remain);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hourUtc, minuteUtc]);

  if (ms === null) {
    // First render matches the final shape so hydration paints no shift.
    return <span className="font-mono text-[13px] font-bold text-beg-ink">--h --m --s</span>;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);

  return (
    <span className="font-mono text-[13px] font-bold text-beg-ink" title={`Next automatic payout: ${hourUtc}:${minuteUtc} UTC`}>
      {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m {String(s).padStart(2, "0")}s
    </span>
  );
}
