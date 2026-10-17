import type { Metadata } from "next";
import Link from "next/link";

import { MarkAllRead } from "@/components/mark-all-read";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * Every alert this account has, not just the last five in the bell.
 *
 * READ THROUGH THE CALLER'S SESSION. `notifications_own` in migration 0010 is
 * the authorisation, so a bug in this page can return an empty list but cannot
 * return somebody else's rows. Creation stays service-role only: a client that
 * could insert an alert could forge attention, which is worse than forging a
 * number because it arrives looking like the product cares.
 */
export default async function NotificationsPage() {
  const sb = await createClient();
  const [rowsResult, countResult] = await Promise.all([
    sb
      .from("notifications")
      .select("id, kind, title, body, href, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  const rows = (rowsResult.data ?? []) as {
    id: string;
    kind: string;
    title: string;
    body: string;
    href: string | null;
    read_at: string | null;
    created_at: string;
  }[];
  const unread = countResult.count ?? rows.filter((r) => r.read_at === null).length;
  const failed = Boolean(rowsResult.error);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Notifications</h1>
          <p className="mt-1 text-beg-dim">
            Alerts written when the chain did something: money arrived, a payout landed, a pool ran low.
          </p>
        </div>
        {!failed && unread > 0 ? <MarkAllRead ids={rows.filter((r) => r.read_at === null).map((r) => r.id)} /> : null}
      </header>

      {failed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read notifications just now. This is the database, not an empty inbox. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <div className="notice-dashed p-5">
          <p>Nothing yet. Alerts appear when a transfer to your wallet is confirmed or a payout settles.</p>
          <p className="mt-2 text-[13px]">
            The bell in the header shows the same rows, so there is no second inbox to keep up with.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`card-sm flex flex-wrap items-start justify-between gap-3 ${
                row.read_at === null ? "border-[2.5px] bg-beg-lime/10" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-beg-ink">
                  {row.title}
                  {row.read_at === null ? (
                    <span className="rounded-full bg-beg-lime px-2 py-0.5 text-[10px] font-extrabold">new</span>
                  ) : null}
                </p>
                <p className="mt-1 text-[13px] text-beg-dim">{row.body}</p>
                {row.href ? (
                  <Link
                    href={row.href}
                    className="mt-2 inline-block text-[13px] font-bold text-beg-ink underline decoration-beg-lime decoration-2 underline-offset-2"
                  >
                    Open it →
                  </Link>
                ) : null}
              </div>
              <time className="shrink-0 text-[11px] text-beg-dim" dateTime={row.created_at}>
                {new Date(row.created_at).toLocaleString("en-GB")}
              </time>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] text-beg-dim">
        Alerts are written from confirmed on-chain rows. The indexer can lag the chain, so an alert arrives after the
        transaction, not before it.
      </p>
    </>
  );
}
