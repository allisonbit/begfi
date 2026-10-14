"use client";

import { useState } from "react";

/**
 * The "Copy CA" button — one tap → the contract address on the clipboard.
 * One shared transient "Copied" state; no toast library for one button.
 */
export function CopyCA({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        function done() {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }
        if (navigator.clipboard?.writeText) {
          navigator.clipboard
            .writeText(address)
            .then(done)
            .catch(() => {
              /* clipboard denied — no copy happened, and no label should lie */
            });
        }
      }}
      className="rounded-full border-[1.5px] border-beg-ink bg-beg-card px-3 py-1 text-[12px] font-bold text-beg-ink hover:bg-beg-lime"
    >
      {copied ? "Copied!" : "Copy CA"}
    </button>
  );
}
