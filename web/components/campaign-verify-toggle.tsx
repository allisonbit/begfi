"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * THE VERIFY BADGE, in admin hands only.
 *
 * A small control with a serious job: it flips `is_verified` — the public
 * "this project is vetted by BegFi" signal. The server re-checks the admin
 * allowlist on every press; this button is only the shape of the request,
 * never the authority.
 */
export function CampaignVerifyToggle({ id, verified }: { id: string; verified: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaign/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", id, verified: !verified }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Could not change the badge.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — badge unchanged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        className={`rounded-full border-[1.5px] px-3 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 ${
          verified
            ? "border-beg-line bg-beg-card text-beg-dim hover:text-beg-ink"
            : "border-beg-ink bg-beg-lime text-beg-ink"
        }`}
      >
        {busy ? "…" : verified ? "Un-verify" : "✓ Verify"}
      </button>
      {error && <span className="text-[11px] text-[#c0392b]">{error}</span>}
    </span>
  );
}
