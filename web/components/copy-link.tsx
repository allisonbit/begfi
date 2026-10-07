"use client";

import { useState } from "react";

/**
 * Copy the profile link, with the share targets that matter for this product
 * (spec §6): X, Telegram and WhatsApp, then plain copy.
 *
 * The clipboard call is wrapped because it rejects in more situations than it
 * looks like it should — a non-secure origin, a denied permission, or a browser
 * that has the API but refuses it in an iframe. The link is on screen either
 * way, so a failure here is not worth an error message; the button just does not
 * claim to have copied anything.
 */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const absolute = url.startsWith("http") ? url : `https://${url}`;
  const shareText = encodeURIComponent("Send me some $BEG");

  async function copy() {
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* see above — nothing to report */
    }
  }

  return (
    <section className="grid gap-3">
      <div className="grid max-sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-2 pl-[18px] sm:flex sm:rounded-full sm:py-1.5 sm:pr-1.5">
        <span className="flex min-w-0 items-center sm:flex-1 truncate font-bold text-beg-ink max-sm:py-2">{absolute}</span>
        <button
          type="button"
          onClick={copy}
          className="btn-primary shrink-0 max-sm:px-4 max-sm:py-2.5 max-sm:text-[13px] sm:px-5 sm:py-3 sm:text-[15px]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-[13px]">
        <a
          className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-beg-dim hover:border-beg-lime"
          href={`https://x.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(absolute)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on X
        </a>
        <a
          className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-beg-dim hover:border-beg-lime"
          href={`https://t.me/share/url?url=${encodeURIComponent(absolute)}&text=${shareText}`}
          target="_blank"
          rel="noreferrer"
        >
          Telegram
        </a>
        <a
          className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-beg-dim hover:border-beg-lime"
          href={`https://wa.me/?text=${shareText}%20${encodeURIComponent(absolute)}`}
          target="_blank"
          rel="noreferrer"
        >
          WhatsApp
        </a>
      </div>
    </section>
  );
}
