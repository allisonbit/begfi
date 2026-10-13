import { TelegramIcon, XIcon } from "@/components/community-links";

/**
 * A token's socials, as chips.
 *
 * The launcher submitted these at launch; the page shows what was recorded,
 * not what would be nice to imagine. A missing network is absent, not
 * greyed out. Unknown handles open nothing.
 */
export function TokenSocials({ socials }: { socials: NonNullable<import("@/lib/types").Launch["socials"]> }) {
  const links: { label: string; href: string; icon: React.ReactNode }[] = [];
  if (socials.twitter) {
    links.push({
      label: "X",
      href: socials.twitter.startsWith("http") ? socials.twitter : `https://x.com/${socials.twitter.replace(/^@/, "")}`,
      icon: <XIcon className="size-[14px]" />,
    });
  }
  if (socials.telegram) {
    links.push({
      label: "Telegram",
      href: socials.telegram.startsWith("http") ? socials.telegram : `https://t.me/${socials.telegram.replace(/^@/, "")}`,
      icon: <TelegramIcon className="size-[15px]" />,
    });
  }
  if (socials.website) {
    links.push({ label: "Website", href: socials.website, icon: <span aria-hidden>🌐</span> });
  }

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost inline-flex items-center gap-2 px-3.5 py-2 text-[12px] font-bold text-beg-ink"
        >
          {l.icon}
          {l.label}
        </a>
      ))}
    </div>
  );
}
