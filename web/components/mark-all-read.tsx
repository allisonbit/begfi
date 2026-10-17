"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Mark every unread alert read, in one POST.
 *
 * The API caps a batch at 100 and the page asks for at most 100 rows, so the
 * list passed in is exactly what the route accepts. A failure says so and
 * changes nothing: dropping the dot before the write lands would make the page
 * lie about what the database knows.
 */
export function MarkAllRead({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ids.length === 0) return null;

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark-read", ids: ids.slice(0, 100) }),
      });
      if (!res.ok) {
        setError("Couldn't mark them read. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network problem — nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button type="button" onClick={() => void mark()} disabled={busy} className="btn-ghost px-4 py-2 text-[13px] disabled:opacity-40">
        {busy ? "Marking…" : `Mark all ${ids.length} read`}
      </button>
      {error ? <p className="mt-1 text-[12px] text-beg-ink">{error}</p> : null}
    </div>
  );
}
