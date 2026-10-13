"use client";

import { useState } from "react";

/**
 * The Earn review console's hands: approve, reject, and the settings knobs.
 *
 * Two components because they share no state and the page renders them in
 * different cards. The admin sees them only when the server has already
 * decided they are an admin — these buttons exist purely to carry the action
 * they are labeled with, and the routes re-verify the session anyway.
 */

export function ReviewActions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/earn/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setMessage(action === "approve" ? "Approved — reward is claimable." : "Rejected.");
        // A full refresh keeps the pending list and the pool meter honest.
        setTimeout(() => window.location.reload(), 700);
      } else {
        setMessage(body?.error ?? "Could not review that one.");
        setBusy(false);
      }
    } catch {
      setMessage("Network hiccup — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <button type="button" onClick={() => void act("approve")} disabled={busy} className="btn-primary px-4 py-2 text-[13px]">
          Approve
        </button>
        <button type="button" onClick={() => void act("reject")} disabled={busy} className="btn-ghost px-4 py-2 text-[13px] font-bold">
          Reject
        </button>
      </div>
      {message ? <p className="text-[12px] text-beg-dim">{message}</p> : null}
    </div>
  );
}

export function SettingsForm({
  rewardPerPostDisplay,
  dailyLimit,
  poolTotalDisplay,
  poolRemainingDisplay,
  isActive,
}: {
  rewardPerPostDisplay: string;
  dailyLimit: number;
  poolTotalDisplay: string;
  poolRemainingDisplay: string;
  isActive: boolean;
}) {
  const [reward, setReward] = useState(rewardPerPostDisplay);
  const [limit, setLimit] = useState(String(dailyLimit));
  const [total, setTotal] = useState(poolTotalDisplay);
  const [topUp, setTopUp] = useState("");
  const [active, setActive] = useState(isActive);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const field =
    "rounded-xl border-[1.5px] border-beg-line bg-beg-card px-3 py-2 font-bold text-beg-ink outline-none";

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/earn/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rewardPerPostDisplay: reward === rewardPerPostDisplay ? undefined : Number(reward.replace(/,/g, "")),
          dailyLimit: limit === String(dailyLimit) ? undefined : Number(limit),
          poolTotalDisplay: total === poolTotalDisplay ? undefined : Number(total.replace(/,/g, "")),
          poolTopUpDisplay: topUp.trim() === "" ? undefined : Number(topUp.replace(/,/g, "")),
          isActive: active,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setMessage("Saved.");
        setTimeout(() => window.location.reload(), 600);
      } else {
        setMessage(body?.error ?? "Save failed.");
      }
    } catch {
      setMessage("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card grid gap-3">
      <div className="flex items-baseline justify-between">
        <b className="text-[16px] text-beg-ink">Earn settings</b>
        <span className="text-[12px] text-beg-dim">Pool remaining: {poolRemainingDisplay} $BEGFI</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-[12px] text-beg-dim">Reward per post ($BEGFI)</span>
          <input value={reward} onChange={(e) => setReward(e.target.value.replace(/[^0-9,]/g, ""))} className={field} inputMode="numeric" />
        </label>
        <label className="grid gap-1">
          <span className="text-[12px] text-beg-dim">Daily limit per account</span>
          <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))} className={field} inputMode="numeric" />
        </label>
        <label className="grid gap-1">
          <span className="text-[12px] text-beg-dim">Pool total ($BEGFI)</span>
          <input value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9,]/g, ""))} className={field} inputMode="numeric" />
        </label>
        <label className="grid gap-1">
          <span className="text-[12px] text-beg-dim">Top up remaining ($BEGFI)</span>
          <input value={topUp} onChange={(e) => setTopUp(e.target.value.replace(/[^0-9,]/g, ""))} placeholder="optional add" className={field} inputMode="numeric" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[13px] font-bold text-beg-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-black" />
        Earn is live — submissions accepted
      </label>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary px-5 py-2.5 text-[13px]">
          {busy ? "Saving…" : "Save settings"}
        </button>
        {message ? <span className="text-[12px] text-beg-dim">{message}</span> : null}
      </div>
    </section>
  );
}
