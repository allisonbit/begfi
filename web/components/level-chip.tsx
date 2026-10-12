import type { ReactNode } from "react";

/**
 * The creator level chip: one small sticker, and that is the whole UI.
 *
 * There is no badge wall and no level-mania by design (the request is explicit
 * about this): the chip names where a creator's real on-chain numbers put
 * them, and it renders identically on the profile page and on Explore cards so
 * the same name means the same thing in both places. Nothing here is clickable
 * into a points page — the chip is a word, not a product.
 */
const TONES: Record<string, string> = {
  Protocol: "bg-beg-ink text-beg-lime",
  Legend: "bg-beg-blue text-beg-ink",
  Onchain: "bg-beg-lime text-beg-ink",
  Grinder: "bg-beg-yellow text-beg-ink",
  Asker: "bg-beg-card text-beg-ink",
  Newborn: "bg-beg-card text-beg-ink",
  "Starting out": "bg-beg-card text-beg-dim",
};

export function LevelChip({ level, rounded = "rounded-md" }: { level: string; rounded?: string }) {
  return (
    <span
      className={`inline-block ${rounded} border-2 border-beg-ink px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[.04em] ${
        TONES[level] ?? "bg-beg-card text-beg-ink"
      }`}
    >
      {level}
    </span>
  );
}

export type { ReactNode };
