"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { track } from "@/lib/analytics";
import { formatAmount } from "@/lib/erc20";

/**
 * The owner's requests, with the two things they actually do to one: copy the
 * link, and retire it.
 *
 * WHY THE STATUS IS PASSED IN RATHER THAN FETCHED HERE. Whether a request has
 * been paid is a fact about confirmed on-chain transfers, and this component
 * would need a per-row round trip to find out — the page already knows, because
 * it asked the database once. A browser island that refetched money facts would
 * also be a second place "paid" is decided, which is exactly what `settlementFor`
 * exists to prevent.
 *
 * WHICH IS WHY "PAID" ISN'T DERIVED HERE EITHER: the row gets the received
 * figure the server computed, and nothing else.
 */
export type PayLinkListItem = {
  id: string;
  amount: string | null;
  memo: string | null;
  is_active: boolean;
  created_at: string;
  received_total: string | null;
  paid: boolean;
};

export function PayLinkList({ items }: { items: PayLinkListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, next: boolean) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch("/api/pay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, isActive: next }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Couldn't change that link.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Network problem — the link is unchanged.");
    } finally {
      setBusyId(null);
    }
  }

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/pay/${id}`);
      setCopiedId(id);
      track("link_copied", { kind: "pay_link" });
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* Clipboard blocked; the link is visible on the page it opens. */
    }
  }

  if (items.length === 0) {
    return (
      <p className="notice-dashed p-5 text-[13px]">
        No requests yet. Make one above and it appears here with its own link.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item.id} className="card-sm grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="text-[16px] text-beg-ink">
                  {item.amount ? `${formatAmount(BigInt(item.amount))} $BEGFI` : "Any amount"}
                </b>
                <p className="truncate text-[13px] text-beg-dim">{item.memo ?? "No note on this one"}</p>
              </div>
              <span
                className={`rounded-full border-[1.5px] border-beg-ink px-2.5 py-0.5 text-[11px] font-bold ${
                  item.paid
                    ? "bg-beg-lime text-beg-ink"
                    : item.is_active
                      ? "bg-beg-bg text-beg-dim"
                      : "bg-beg-bg text-beg-dim"
                }`}
              >
                {item.paid ? "Paid" : item.is_active ? "Waiting" : "Closed"}
              </span>
            </div>

            <p className="text-[12px] text-beg-dim">
              {item.received_total
                ? `${formatAmount(BigInt(item.received_total))} $BEGFI received since it was created`
                : "Received total unavailable right now"}
              {" · "}
              {new Date(item.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>

            <div className="flex flex-wrap gap-2">
              <Link href={`/pay/${item.id}`} className="btn-primary px-3 py-2 text-[13px]">
                Open
              </Link>
              <button
                type="button"
                onClick={() => void copy(item.id)}
                className="btn-ghost px-3 py-2 text-[13px] font-bold text-beg-ink"
              >
                {copiedId === item.id ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => void toggle(item.id, !item.is_active)}
                disabled={busyId === item.id || pending}
                className="btn-ghost px-3 py-2 text-[13px] font-bold text-beg-ink disabled:opacity-40"
              >
                {busyId === item.id
                  ? "Working…"
                  : item.is_active
                    ? "Close request"
                    : "Reopen request"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
