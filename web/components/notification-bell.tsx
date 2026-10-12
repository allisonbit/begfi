"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The notification bell.
 *
 * A poll, not a socket: this product's events land on cron and page refreshes,
 * and a bell that showed zero because a websocket never opened would be the
 * exact kind of lie this app refuses. Polls every 30s while the panel is
 * visible and pauses when the tab is hidden, so the public RPC and PostgREST
 * are not paying for a background tab's curiosity.
 *
 * Renderer rules: rows come only from the database (the cron writes them from
 * confirmed on-chain events), so there is nothing to invent client-side. Unread
 * rows show the dot, "Mark all read" flips them with one POST, and the empty
 * state says notifications arrive when the chain does something — not "no
 * alerts!" as a feature flourish.
 */
type Row = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  beg: "Beg",
  fees: "Fees",
  launch: "Launch",
  graduation: "Graduated",
  move: "Moved",
  claim: "Claim",
  digest: "Daily",
};

const KIND_BG: Record<string, string> = {
  beg: "bg-beg-lime text-beg-ink",
  fees: "bg-beg-blue text-beg-ink",
  launch: "bg-beg-yellow text-beg-ink",
  graduation: "bg-beg-lime text-beg-ink",
  move: "bg-beg-yellow text-beg-ink",
  claim: "bg-beg-blue text-beg-ink",
  digest: "bg-beg-card text-beg-ink",
};

export function NotificationBell({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (!signedIn) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { ok: boolean; unread: number; rows: Row[] };
      setRows(body.rows ?? []);
      setUnread(body.unread ?? 0);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoading(true);
    void load().finally(() => alive && setLoading(false));

    const tick = setInterval(() => {
      if (!document.hidden && !open) void load();
    }, 30_000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!signedIn) return null;

  async function markAll() {
    const unreadIds = rows.filter((r) => r.read_at === null).map((r) => r.id);
    if (unreadIds.length === 0) return;
    setUnread(0);
    setRows((rs) => rs.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark-read", ids: unreadIds }),
      });
    } catch {
      // Roll nothing back: a failed mark-read leaves the dots on screen after
      // the next poll. Optimism here wrongs nobody.
      void load();
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-grid size-10 place-items-center rounded-full border-[1.5px] border-beg-line bg-beg-card text-beg-ink hover:border-beg-ink"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full border-2 border-beg-ink bg-beg-lime px-1 text-[10px] font-extrabold text-beg-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[320px] max-w-[86vw] rounded-2xl border-[3px] border-beg-ink bg-beg-card p-3 shadow-glow">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[14px]">Notifications</b>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="text-[12px] font-bold text-beg-ink underline underline-offset-2"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="notice-dashed p-3 text-[12px]">Couldn&apos;t reach your notifications. Try again.</p>
          ) : loading && rows.length === 0 ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse-soft rounded-xl bg-beg-bg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-3 text-[13px] text-beg-dim">
              Nothing yet. Notifications arrive when the chain does something: a beg lands, fees
              become claimable, a launch confirms, a watched token moves.
            </p>
          ) : (
            <ul className="grid max-h-[380px] gap-1.5 overflow-y-auto">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-xl p-2.5 text-[12px] ${r.read_at === null ? "bg-beg-bg" : "bg-beg-card"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md border-2 border-beg-ink px-1 py-0.5 text-[9px] font-extrabold ${
                        KIND_BG[r.kind] ?? "bg-beg-card"
                      }`}
                    >
                      {KIND_LABELS[r.kind] ?? r.kind}
                    </span>
                    <b className="truncate text-beg-ink">{r.title}</b>
                  </div>
                  <p className="mt-1 text-beg-dim">{r.body}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-beg-dim">
                      {new Date(r.created_at).toLocaleString("en-GB")}
                    </span>
                    {r.href ? (
                      <a href={r.href} className="text-beg-ink underline underline-offset-2" onClick={() => setOpen(false)}>
                        Open
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
