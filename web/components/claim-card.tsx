"use client";

import { useEffect, useState } from "react";

import { RobinhoodFeather } from "@/components/robinhood-feather";
import { TelegramIcon, XIcon } from "@/components/community-links";
import { LINK_ORIGIN } from "@/lib/config";

/**
 * The claim card: the moment of getting paid, as something to post.
 *
 * WHY IT LEADS THE EXIT. Getting paid is the story BegFi runs on — the ask,
 * answered. So the receipt shows first and sharing is THE action on it: a
 * prefilled X post ("I just earned 10,000 $BEGFI begging onchain 🙏") that
 * opens with one press, then Telegram, then plain copy. Closing still works
 * for the shy; nobody is trapped.
 *
 * The X intent is not an API call and cannot read anything back — the text
 * is composed here and opened on x.com. No keys, no tracking.
 */
export function ClaimCard({
  amount,
  username,
  onClose,
}: {
  amount: string;
  username: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);

  /* Spring in the card one tick after mount so the backdrop paints first. */
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 30);
    return () => clearTimeout(t);
  }, []);

  const link = `${LINK_ORIGIN}/${username}`;
  const shareText = encodeURIComponent(
    `I just earned ${amount} $BEGFI for posting about BegFi — the e-Begging protocol. Get paid to beg: ${link}`,
  );
  const shareUrl = encodeURIComponent(link);

  const xIntent = `https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`;
  const tgShare = `https://t.me/share/url?url=${shareUrl}&text=${shareText}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Claim receipt"
    >
      {/* Click-away backdrop. A share must never be a corner. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-beg-ink/40 backdrop-blur-[2px] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />

      <div
        className={`animate-pop-in relative grid max-w-[420px] gap-4 rounded-[26px] border-[3px] border-beg-ink bg-beg-card p-6 text-center shadow-glow-strong transition-transform duration-200 ${open ? "scale-100" : "scale-95"}`}
      >
        <div className="grid justify-items-center gap-1">
          <span className="rounded-full border-2 border-beg-ink bg-beg-lime px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em] text-beg-ink">
            Paid
            <RobinhoodFeather className="ml-1 text-beg-logo" />
          </span>
          <b className="text-[26px] font-extrabold tracking-[-.03em] text-beg-ink">
            You just earned {amount} $BEGFI
          </b>
          <p className="text-[13px] text-beg-dim">
            Straight to your wallet. Tell the timeline — it&apos;s the whole game.
          </p>
        </div>

        <div className="grid gap-2">
          <a href={xIntent} target="_blank" rel="noreferrer" className="btn-primary grid place-items-center py-3 text-[15px]">
            <span className="inline-flex items-center gap-2">
              <XIcon className="size-[15px]" />
              Post to X
            </span>
          </a>
          <div className="flex gap-2">
            <a href={tgShare} target="_blank" rel="noreferrer" className="btn-ghost inline-flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-[13px] font-bold text-beg-ink">
              <TelegramIcon className="size-[14px]" />
              Telegram
            </a>
            <CopyChip text={`I just earned ${amount} $BEGFI on BegFi — ${link}`} />
          </div>
        </div>

        {/* Escaping the moment is one click, never zero: closing is allowed, after the share buttons have had first position. */}
        <button
          type="button"
          onClick={onClose}
          className="justify-self-center text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink"
        >
          No thanks, close
        </button>
      </div>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is on screen either way */
    }
  }

  return (
    <button type="button" onClick={() => void copy()} className="btn-ghost flex-1 px-3 py-2.5 text-[13px] font-bold text-beg-ink">
      {copied ? "Copied!" : "Copy text"}
    </button>
  );
}
