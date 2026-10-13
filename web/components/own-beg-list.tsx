import Link from "next/link";
import { formatAmount } from "@/lib/erc20";
import type { OwnBeg } from "@/lib/dashboard";

/**
 * The user's own begs on the Begs tab.
 *
 * Server component: nothing here needs a browser. Each row links to the beg's
 * public page (`/beg/<id>`), where the share buttons and the generated image
 * live — this list deliberately does not duplicate them, because two share
 * buttons for one beg is how links drift out of date.
 */
export function OwnBegList({ begs }: { begs: OwnBeg[] }) {
  return (
    <ul className="grid gap-2">
      {begs.map((b) => (
        <li key={b.id} className="card-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/beg/${b.id}`}
              className="text-[14px] font-bold text-beg-ink underline underline-offset-2"
            >
              Open beg
            </Link>
            <span className="text-[11px] text-beg-dim">
              {new Date(b.created_at).toLocaleString("en-GB")}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13px] text-beg-dim">{b.body}</p>
          <p className="mt-1 text-[12px] text-beg-dim">
            Goal: {b.goal ? `${formatAmount(BigInt(b.goal))} $BEGFI` : "open ended"}
          </p>
          <span className="font-mono text-[11px] text-beg-dim">begfi.io/beg/{b.id}</span>
        </li>
      ))}
    </ul>
  );
}
