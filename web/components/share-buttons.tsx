"use client";

import { useState } from "react";

/**
 * Share a beg to X, Telegram or WhatsApp.
 *
 * The point of the generated image is that it shows up when the LINK is posted —
 * not when an image file is uploaded. So these share the URL, and the crawler on
 * the other end fetches the picture made by `opengraph-image.tsx`. Sharing a
 * downloaded PNG instead would lose the click-through, and the click-through is
 * how someone ends up on the page with a wallet.
 *
 * `url` must be absolute and publicly reachable. A relative URL or a localhost
 * one produces a blank preview, which looks like a broken post rather than a
 * broken configuration.
 */
export function ShareButtons({
  url,
  text,
  caption = "The link carries the image — posting it shows your words, and clicking it opens your page.",
}: {
  url: string;
  text: string;
  /**
   * Optional, because the default line is written for a beg's author. A caller
   * that shares something without a generated image (the feed) passes its own
   * so it does not borrow a promise the page cannot keep.
   */
  caption?: string;
}) {
  const [copied, setCopied] = useState(false);

  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  const targets = [
    { label: "Post to X", href: `https://x.com/intent/post?text=${encodedText}&url=${encoded}` },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encoded}&text=${encodedText}`,
    },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodedText}%20${encoded}` },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked; the link is on screen anyway */
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {targets.map((t) => (
          <a
            key={t.label}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost p-3.5 text-center text-[14px] font-bold text-beg-ink"
          >
            {t.label}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-full border-[1.5px] border-beg-line bg-beg-card py-1.5 pl-4 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-beg-dim">{url}</span>
        <button
          type="button"
          onClick={copy}
          className="btn-primary shrink-0 px-4 py-2.5 text-[13px]"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <p className="text-[12px] text-beg-dim">{caption}</p>
    </div>
  );
}
