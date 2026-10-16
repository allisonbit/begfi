"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Coins,
  ExternalLink,
  Gift,
  HandCoins,
  LayoutDashboard,
  Megaphone,
  PenLine,
  ShieldCheck,
  UserCog,
  Wallet,
} from "lucide-react";

import { linkFor } from "@/lib/config";

/**
 * The dashboard shell: a sidebar on desktop, the tab row on mobile.
 *
 * WHY A SIDEBAR AND NOT MORE TABS. Every section used to live in one
 * horizontally-scrolling row of pills, which works for three items and breaks
 * at eight: the row scrolls sideways, so a section you cannot see is a section
 * you do not know exists. `/dashboard/profile` was reachable only by typing its
 * URL — it was never in the tab row at all. A vertical list has room to show
 * every section at once, which is the entire point.
 *
 * WHY THE SIDEBAR IS `md:` ONLY, AND WHY THERE IS NO SECOND BOTTOM BAR. The
 * plan asks for a left sidebar plus a bottom tab bar on mobile. The product
 * already has a global bottom dock (Begs / Earn / Board / You) fixed on phones,
 * and stacking a dashboard tab bar on top of it would put two navigation bars
 * in the same thumb's reach, one of which is invisible behind the other. So on
 * phones the dashboard keeps its scrolling pill row — which sits under the page
 * title, above the content, exactly where the detail tabs belong — and the
 * sidebar appears as soon as there is width for it. Adapting the plan's intent
 * to the app that exists beats duplicating chrome that already works.
 *
 * WHY THE SECTION LIST IS BUILT HERE RATHER THAN PASSED IN. Icons are React
 * components, and a server component cannot pass one to a client component —
 * it is not serialisable. So the client owns the list and takes the one thing
 * the server actually knows: whether this wallet is an admin.
 *
 * EVERY HREF HERE RESOLVES TO A PAGE THAT EXISTS, and every dashboard page
 * appears here. A menu entry with nothing behind it is worse than a missing
 * feature (see `DECISIONS.md` D-030), and a page no menu entry points at is a
 * page nobody finds.
 */

type NavItem = { href: string; label: string; Icon: LucideIcon };
type NavGroup = { title: string; items: NavItem[] };

function groups(isAdmin: boolean): NavGroup[] {
  const main: NavGroup = {
    title: "Your account",
    items: [
      { href: "/dashboard", label: "Overview", Icon: LayoutDashboard },
      { href: "/dashboard/begs", label: "Begs", Icon: HandCoins },
      { href: "/dashboard/pay-links", label: "Pay links", Icon: Coins },
      { href: "/dashboard/campaigns", label: "Campaigns", Icon: Megaphone },
      { href: "/dashboard/drops", label: "Drops", Icon: Gift },
      { href: "/dashboard/activity", label: "Activity", Icon: Activity },
      { href: "/dashboard/profile", label: "Profile", Icon: UserCog },
    ],
  };

  /*
   * Admin sections are appended, never conditionally substituted. The console
   * already gates itself server-side (`isAdminWallet`); this only decides
   * whether the door is drawn on the wall, so a non-admin sees a dashboard that
   * does not pretend to have admin pages at all.
   */
  if (!isAdmin) return [main];

  return [
    main,
    {
      title: "Admin",
      items: [
        { href: "/dashboard/earn", label: "Earn review", Icon: ShieldCheck },
        { href: "/dashboard/earn/payouts", label: "Auto payouts", Icon: Wallet },
      ],
    },
  ];
}

/**
 * The one entry that is active. Longest match wins.
 *
 * Without this, `/dashboard/earn/payouts` lights up BOTH "Earn review" (whose
 * href is a prefix of it) and "Auto payouts", and a sidebar that highlights two
 * places at once tells you nothing about where you are. Picking the most
 * specific match removes the ambiguity by construction rather than by careful
 * ordering of the list.
 */
function activeHref(pathname: string, items: NavItem[]): string | null {
  const matches = items.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

export function DashboardShell({ isAdmin, username }: { isAdmin: boolean; username: string }) {
  const pathname = usePathname();
  const all = groups(isAdmin);
  const flat = all.flatMap((g) => g.items);
  const active = activeHref(pathname, flat);

  return (
    <>
      {/* Phones and small tablets: the tab row, under the page title. */}
      <nav
        aria-label="Dashboard sections"
        className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
      >
        <ul className="flex min-w-max gap-2">
          {flat.map(({ href, label, Icon }) => {
            const isOn = href === active;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isOn ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-3.5 py-2.5 text-[14px] font-bold transition-colors ${
                    isOn
                      ? "border-beg-ink bg-beg-lime text-beg-ink shadow-glow"
                      : "border-beg-line text-beg-dim hover:border-beg-ink hover:text-beg-ink"
                  }`}
                >
                  <Icon size={17} strokeWidth={isOn ? 2.4 : 2} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/*
        Desktop: the sticky rail. `self-start` is required — a stretched grid
        item never scrolls independently, so `sticky` would do nothing on a tall
        column of content. The top offset clears the sticky header.
      */}
      <aside className="hidden md:sticky md:top-24 md:block md:self-start">
        <Link
          href="/dashboard/begs"
          className="mb-5 flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-beg-ink bg-beg-lime px-3 py-3 text-[14px] font-extrabold text-beg-ink shadow-glow transition-transform hover:scale-[1.02]"
        >
          <PenLine size={17} strokeWidth={2.4} aria-hidden />
          Write a beg
        </Link>

        <nav aria-label="Dashboard sections">
          {all.map((group) => (
            <div key={group.title} className="mb-6">
              <h2 className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[.09em] text-beg-dim">
                {group.title}
              </h2>
              <ul className="grid gap-1">
                {group.items.map(({ href, label, Icon }) => {
                  const isOn = href === active;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={isOn ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] font-bold transition-colors ${
                          isOn
                            ? "bg-beg-lime text-beg-ink"
                            : "text-beg-dim hover:bg-beg-card hover:text-beg-ink"
                        }`}
                      >
                        <Icon size={18} strokeWidth={isOn ? 2.4 : 2} aria-hidden />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/*
          The public page, one click away. `linkFor` rather than a hardcoded
          path, because that is the address people are told their link lives at
          — the sidebar must not disagree with the copy that quotes it.
        */}
        <a
          href={linkFor(username)}
          className="flex items-center gap-2 rounded-xl border-[1.5px] border-beg-line px-2.5 py-2 text-[13px] font-bold text-beg-dim transition-colors hover:border-beg-ink hover:text-beg-ink"
        >
          <ExternalLink size={15} aria-hidden />
          <span className="truncate">/{username}</span>
        </a>
      </aside>
    </>
  );
}
