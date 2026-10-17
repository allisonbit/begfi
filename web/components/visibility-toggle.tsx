"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * The public-profile switch.
 *
 * WRITTEN THROUGH THE SESSION, not a route: `profiles_update_self` in migration
 * 0001 already authorises exactly this row and this column, so there is no
 * second rule to keep in step with it. The label changes only after the write
 * returns, because a switch that flips before the database agrees is the kind
 * of lie that makes people think their profile is private when it is not.
 */
export function VisibilityToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !hidden;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) {
        setError("Your session expired. Sign in again.");
        return;
      }
      const { error: updateError } = await supabase.from("profiles").update({ is_hidden: next }).eq("id", id);
      if (updateError) {
        setError("Couldn't change that. Try again.");
        return;
      }
      setHidden(next);
      router.refresh();
    } catch {
      setError("Network problem — nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[14px] font-bold text-beg-ink">
        {hidden ? "Hidden from public pages" : "Visible to everyone"}
      </p>
      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy}
        aria-pressed={hidden}
        className={`rounded-full border-2 border-beg-ink px-4 py-2 text-[13px] font-extrabold transition-colors disabled:opacity-40 ${
          hidden ? "bg-beg-card text-beg-ink hover:bg-beg-lime" : "bg-beg-lime text-beg-ink"
        }`}
      >
        {busy ? "Saving…" : hidden ? "Make public" : "Hide my profile"}
      </button>
      {error ? <p className="w-full text-[12px] text-beg-ink">{error}</p> : null}
    </div>
  );
}
