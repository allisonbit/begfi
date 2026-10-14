"use client";

import { useState } from "react";

/**
 * The payment page's QR and share-card block.
 *
 * ONE SOURCE. The QR itself always comes from /api/qr/[username] — a server
 * render of the real link — so the card, the download and the preview can
 * never disagree about where the code points.
 *
 * THE SHARE CARD is a real generated image (same API family), carrying the
 * username, the QR and the one line a post needs: "Pay me in $BEGFI". The X
 * and Telegram buttons are intents that open with the card's address and the
 * site link — not fabricated uploads, just the standard share targets.
 */
export function QRShare({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const qrSrc = `/api/qr/${username}`;
  const cardSrc = `/api/qr/${username}?card=1`;
  const site = `https://begfi.io/${username}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(site);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible either way */
    }
  }

  return (
    <section className="card grid gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <b className="text-[17px] text-beg-ink">Pay me in $BEGFI</b>
          <p className="mt-1 text-[13px] text-beg-dim">
            Scan, or point any wallet camera at this code. It opens this page.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt={`QR code linking to begfi.io/${username}`}
          width={120}
          height={120}
          className="size-[120px] rounded-xl border-2 border-beg-ink bg-beg-bg"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={`${qrSrc}?download=1`} className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink">
          Download QR
        </a>
        <button type="button" onClick={() => void copyLink()} className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <div className="grid gap-2 border-t border-beg-line pt-4">
        <b className="text-[15px] text-beg-ink">Share card</b>
        <p className="text-[13px] text-beg-dim">
          A ready-to-post image: your name, your code, the ask.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardSrc}
          alt={`BegFi share card: pay @${username} in $BEGFI`}
          width={600}
          height={315}
          className="w-full rounded-xl border-2 border-beg-ink"
          loading="lazy"
        />
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(`Pay me in $BEGFI — ${site}`)}&url=${encodeURIComponent(site)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-primary px-4 py-2 text-[13px]"
          >
            Post on X
          </a>
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(site)}&text=${encodeURIComponent("Pay me in $BEGFI")}`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink"
          >
            Telegram
          </a>
          <a href={cardSrc} target="_blank" rel="noreferrer" className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink">
            Open card
          </a>
        </div>
      </div>
    </section>
  );
}
