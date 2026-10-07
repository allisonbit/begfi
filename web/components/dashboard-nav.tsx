"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The dashboard's own navigation.
 *
 * A COLOURED TAB BAR, not a row of grey links. The pages here are the product —
 * your link, your begs, your launches, your money — and they were previously
 * reachable only through small dim text buried under the page heading, which read
 * as footnotes rather than as where you go next. A dashboard whose sections are
 * hard to find is a dashboard nobody uses.
 *
 * The active tab is filled rather than merely tinted, so where you are is legible
 * at a glance on a phone in daylight. `aria-current` says the same thing to a
 * screen reader that the fill says visually.
 */
const TABS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/profile", label: "Edit profile" },
  { href: "/dashboard/activity", label: "Activity" },
  { href: "/dashboard/launches", label: "Launches" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max gap-2">
        {TABS.map((tab) => {
          // Exact match for the overview, prefix for the rest — otherwise
          // `/dashboard` would light up on every sub-page.
          const active = tab.href === "/dashboard" ? pathname === tab.href : pathname.startsWith(tab.href);

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block whitespace-nowrap rounded-full border-[1.5px] px-4 py-2.5 text-[14px] font-bold transition-colors ${
                  active
                    ? "border-beg-lime bg-beg-lime text-beg-ink shadow-glow"
                    : "border-beg-line text-beg-dim hover:border-beg-lime hover:text-beg-ink"
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
