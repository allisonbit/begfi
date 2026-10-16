"use client";

import { useState } from "react";

import { track } from "@/lib/analytics";

/**
 * Sharing a pay request.
 *
 * THE SHARE TEXT CARRIES THE NUMBER. "Pay me $BEGFI" makes the reader open a
 * link to find out how much; "Lunch money — 20 $BEGFI: <url>" is a request they
 * can answer from the notification tray. The amount is baked into every share
 * target here for that reason, and the copy button copies the same one line, so
 * a paste into WhatsApp says exactly what the X post says.
 *
 * ONE SOURCE FOR THE CODE, like the profile page's block: the QR is rendered by
 * `/api/qr/pay/<id>` from the link's own row, so the image, the download and the
 * page can never disagree about where the code points.
 */
export function PayLinkShare({
  url,
  amount,
  memo,
  payLinkId,
  label,
}: {
  url: string;
  amount: string | null;
  memo: string | null;
  payLinkId: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const qrSrc = `/api/qr/pay/${payLinkId}`;

  // The one line. Falls back to something true rather than to a template with a
  // hole in it, because a share text that reads "Pay me null $BEGFI" is worse
  // than a plain one.
  const line = amount
    ? `${memo ?? "Payment request"} — ${amount}: ${url}`
    : `${memo ?? "Pay me in $BEGFI"}: ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      track("link_copied", { kind: "pay_link" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked. The button is a convenience; the text stays selectable. */
    }
  }

  return (
    <section className="card grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <b className="text-[16px] text-beg-ink">Share this request</b>
          <p className="mt-1 text-[13px] text-beg-dim">
            The code opens this page. The text carries the amount, so whoever reads it already knows the
            ask.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt={`QR code for this payment request to ${label}`}
          width={120}
          height={120}
          className="size-[120px] rounded-xl border-2 border-beg-ink bg-beg-bg"
        />
      </div>

      <p className="rounded-xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-[13px] text-beg-ink">
        {line}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="btn-primary px-4 py-2 text-[13px]"
        >
          {copied ? "Copied" : "Copy request"}
        </button>
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(line)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink"
        >
          Post on X
        </a>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
            amount ? `${memo ?? "Payment request"} — ${amount}` : (memo ?? "Pay me in $BEGFI"),
          )}`}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink"
        >
          Telegram
        </a>
        <a
          href={`${qrSrc}?download=1`}
          className="btn-ghost px-4 py-2 text-[13px] font-bold text-beg-ink"
        >
          Download QR
        </a>
      </div>
    </section>
  );
}
