"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * THE OWNER'S CONTROLS, and nothing else is editable on purpose.
 *
 *   pause  — stop NEW claims. Claims already accepted are still paid: pausing
 *            stops the queue, it does not break a promise.
 *   resume — open it again while the window and the pot allow.
 *   extend — move (or clear) the deadline.
 *   end    — final. It is the only action that releases the token's lease,
 *            because it is the only one that stops deposits for good.
 *
 * The prize, the token and the cap are absent here and cannot be changed
 * anywhere: the claim row carries the prize it was made for, so editing the
 * number afterwards would mean either paying a promise at a new number or
 * keeping two numbers that disagree. Ending a drop never strands a claim — the
 * sweep pays accepted claims regardless of the drop's status.
 *
 * "End" asks once before acting, because it cannot be undone.
 */
export function DropOwnerControls({ dropId, status }: { dropId: string; status: "open" | "paused" | "ended" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  async function act(action: "pause" | "resume" | "end") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/drop/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId, action }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setConfirmEnd(false);
        router.refresh();
      } else {
        setError(body?.error ?? "Could not change the drop.");
      }
    } catch {
      setError("Network problem — nothing changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "ended") {
    return <p className="text-[11px] text-beg-dim">This drop has ended. Accepted prizes were still paid.</p>;
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "open" ? (
          <button type="button" onClick={() => void act("pause")} disabled={busy} className="btn-ghost px-3.5 py-2 text-[12px] font-bold text-beg-ink">
            Pause claims
          </button>
        ) : (
          <button type="button" onClick={() => void act("resume")} disabled={busy} className="btn-ghost px-3.5 py-2 text-[12px] font-bold text-beg-ink">
            Resume claims
          </button>
        )}
        {confirmEnd ? (
          <>
            <button type="button" onClick={() => void act("end")} disabled={busy} className="btn-primary px-3.5 py-2 text-[12px]">
              {busy ? "Ending…" : "Yes, end it for good"}
            </button>
            <button type="button" onClick={() => setConfirmEnd(false)} className="btn-ghost px-3.5 py-2 text-[12px] font-bold text-beg-ink">
              Keep it running
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmEnd(true)} disabled={busy} className="btn-ghost px-3.5 py-2 text-[12px] font-bold text-beg-ink">
            End drop
          </button>
        )}
      </div>
      {confirmEnd ? (
        <p className="text-[11px] text-beg-dim">
          Ending is final. It frees the token to fund another pool, and any prize already claimed is still paid.
        </p>
      ) : null}
      {error ? <p className="text-[12px] font-bold text-beg-ink">{error}</p> : null}
    </div>
  );
}
