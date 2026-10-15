"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Draft = {
  id?: string;
  name: string;
  slug: string;
  logoUrl: string;
  bannerUrl: string;
  xUrl: string;
  websiteUrl: string;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  description: string;
  requiredEntry: string;
  instructions: string;
  dailyBudgetDisplay: string;
  status: string;
};

const EMPTY: Draft = {
  name: "",
  slug: "",
  logoUrl: "",
  bannerUrl: "",
  xUrl: "",
  websiteUrl: "",
  tokenName: "",
  tokenSymbol: "",
  tokenAddress: "",
  description: "",
  requiredEntry: "",
  instructions: "",
  dailyBudgetDisplay: "100000",
  status: "active",
};

/**
 * The campaign setup form.
 *
 * It insets its fields into a two-column layout for desktop and a single
 * stack on mobile, and NEVER pretends to save: a failure keeps the values on
 * screen with the server's message, so a half-typed campaign cannot be lost
 * to a network hiccup.
 */
export function CampaignForm({ initial, busyLabel = "Create campaign" }: { initial?: Partial<Draft>; busyLabel?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, ...initial });
  const [open, setOpen] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(initial?.id ? "/api/campaign/update" : "/api/campaign/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          initial?.id
            ? { action: "update", ...draft, dailyBudgetDisplay: Number(draft.dailyBudgetDisplay) }
            : { ...draft, dailyBudgetDisplay: Number(draft.dailyBudgetDisplay) },
        ),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Could not save. Check the fields.");
        return;
      }
      setSaved(initial?.id ? "Saved." : "Campaign live — fund the pool and it starts paying.");
      if (!initial?.id) setDraft({ ...EMPTY });
      router.refresh();
    } catch {
      setError("Network hiccup — nothing was saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border-2 border-beg-ink bg-beg-lime px-4 py-2 text-[13px] font-extrabold text-beg-ink"
      >
        + New campaign
      </button>
    );
  }

  const field = "min-w-0 rounded-xl border-[1.5px] border-beg-line bg-beg-card px-3 py-2 text-[13px] text-beg-ink placeholder:text-beg-dim focus:border-beg-ink focus:outline-none";
  const label = "text-[11px] font-bold uppercase tracking-[.06em] text-beg-dim";

  return (
    <div className="card grid gap-3 p-5">
      <div className="flex items-center justify-between">
        <b className="text-[16px] text-beg-ink">{initial?.id ? "Edit campaign" : "New campaign"}</b>
        {initial?.id && (
          <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-beg-dim underline underline-offset-2">
            Close
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={label}>Project name</span>
          <input className={field} value={draft.name} onChange={set("name")} placeholder="Pepe Earn Campaign" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Campaign slug (/earn/…)</span>
          <input className={field} value={draft.slug} onChange={set("slug")} placeholder="pepe-earn" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Token name</span>
          <input className={field} value={draft.tokenName} onChange={set("tokenName")} placeholder="Pepe" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Token symbol</span>
          <input className={field} value={draft.tokenSymbol} onChange={set("tokenSymbol")} placeholder="PEPE" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={label}>Token contract address</span>
          <input className={field} value={draft.tokenAddress} onChange={set("tokenAddress")} placeholder="0x…" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Daily budget (whole tokens)</span>
          <input className={field} inputMode="numeric" value={draft.dailyBudgetDisplay} onChange={set("dailyBudgetDisplay")} placeholder="1000000" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Status</span>
          <select className={field} value={draft.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
            <option value="draft">Draft</option>
          </select>
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={label}>Required mention / hashtag (must appear in every post)</span>
          <input className={field} value={draft.requiredEntry} onChange={set("requiredEntry")} placeholder="$PEPE or @pepecoin" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={label}>What to post about (instructions)</span>
          <textarea className={`${field} min-h-[70px]`} value={draft.instructions} onChange={set("instructions")} placeholder="Explain what posters must write about." />
        </label>
        <label className="grid gap-1">
          <span className={label}>Logo URL</span>
          <input className={field} value={draft.logoUrl} onChange={set("logoUrl")} placeholder="https://…/logo.png" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Banner URL</span>
          <input className={field} value={draft.bannerUrl} onChange={set("bannerUrl")} placeholder="https://…/banner.png" />
        </label>
        <label className="grid gap-1">
          <span className={label}>X link</span>
          <input className={field} value={draft.xUrl} onChange={set("xUrl")} placeholder="https://x.com/…" />
        </label>
        <label className="grid gap-1">
          <span className={label}>Website</span>
          <input className={field} value={draft.websiteUrl} onChange={set("websiteUrl")} placeholder="https://…" />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={label}>Description</span>
          <textarea className={`${field} min-h-[60px]`} value={draft.description} onChange={set("description")} placeholder="One or two lines about the project." />
        </label>
      </div>

      {error && <p className="text-[12px] font-bold text-[#c0392b]">{error}</p>}
      {saved && <p className="text-[12px] font-bold text-beg-ink">{saved}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl border-2 border-beg-ink bg-beg-lime px-5 py-2.5 text-[13px] font-extrabold text-beg-ink disabled:opacity-50"
        >
          {saving ? "Saving…" : busyLabel}
        </button>
      </div>
      {!initial?.id && (
        <p className="text-[11px] text-beg-dim">
          Funding: send your token from your own wallet to the BegFi distributor wallet (its address is shown on your dashboard
          once the campaign exists). Deposits are detected automatically on-chain and credited to THIS campaign only.
        </p>
      )}
    </div>
  );
}
