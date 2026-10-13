"use client";

import { useState } from "react";

/**
 * Copy a fixed string — an address, a link — with a one-shot feedback state.
 *
 * For the token contract address, where there is nothing to share and no text
 * to compose: someone reading a contract address wants it in their clipboard
 * accurately, which is why the whole chip copies with one press rather than a
 * button running a selection dance. Clipboard failures stay quiet because the
 * text is on screen either way — same rule as CopyLink.
 */
export function CopyText({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the address is on screen either way */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`flex items-center gap-3 rounded-full border-2 border-dashed border-beg-line bg-beg-card px-4 py-2.5 font-mono text-[13px] ${className}`}
      aria-label={`Copy: ${text}`}
    >
      <span className="truncate">{text}</span>
      <span className="text-beg-dim">{copied ? "copied" : "tap to copy"}</span>
    </button>
  );
}
