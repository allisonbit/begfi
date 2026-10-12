"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The dashboard's tab bar: one page, five views.
 *
 * Tabs are links, not buttons, so each view has its own URL and the back
 * button behaves the way phones train people to expect. The active tab is
 * filled with the brick; everything else stays card stock. On narrow screens
 * the bar scrolls sideways rather than wrapping, because a tab bar that
 * becomes two rows on a 360px phone is a menu pretending to be tabs.
 */
const TABS = [
  { slug: "", label: "Overview" },
  { slug: "launches", label: "Launches" },
  { slug: "begs", label: "Begs" },
  { slug: "fees", label: "Fees" },
  { slug: "activity", label: "Activity" },
] as const;

export function DashboardTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard sections" className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max gap-2">
        {TABS.map((tab) => {
          const href = tab.slug ? `/dashboard/${tab.slug}` : "/dashboard";
          const active = tab.slug ? pathname === href : pathname === "/dashboard";

          return (
            <li key={tab.slug || "overview"}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-block whitespace-nowrap rounded-full border-[1.5px] px-4 py-2.5 text-[14px] font-bold transition-colors ${
                  active
                    ? "border-beg-ink bg-beg-lime text-beg-ink shadow-glow"
                    : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
