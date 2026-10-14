import Link from "next/link";
import { CommunityLinks } from "@/components/community-links";
import { RobinhoodFeather } from "@/components/robinhood-feather";
import { TOKEN_CONFIGURED } from "@/lib/config";

/**
 * The site footer.
 *
 * Real links, in one place, on every page. Before this, `/terms` was the only
 * link anywhere on the home page and the footer was a line of text — so a visitor
 * who wanted to explore or follow along had nothing to press.
 */
const COLUMNS = [
  {
    title: "BegFi",
    links: [
      { href: "/", label: "Home" },
      { href: "/begs", label: "Begs" },
      { href: "/earn", label: "Earn" },
      { href: "/leaderboard", label: "Leaderboard" },
      { href: "/explore", label: "Explore" },
    ],
  },
  {
    title: "Your account",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/dashboard/profile", label: "Edit profile" },
      { href: "/dashboard/activity", label: "Activity" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-[3px] border-beg-ink">
      <div className="safe-x mx-auto grid max-w-[1000px] gap-8 py-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
            beg<span className="text-beg-logo">fi</span>
            <RobinhoodFeather className="ml-[0.1em] text-beg-logo" />
          </span>
          <p className="mt-3 max-w-[28ch] text-[13px] text-beg-dim">
            {/*
              The exact copy the brief asks for: "Built on Robinhood Chain",
              and the words "…, $BEGFI is live" become true — and only then
              appear — once the contract address is configured. A footer that
              claims liveness for a token with no address is the lie this
              conditional forbids.
            */}
            Built on Robinhood Chain{TOKEN_CONFIGURED ? ", $BEGFI is live" : ""}.
          </p>
          <CommunityLinks className="mt-4" />
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="mb-3 text-[13px] font-bold text-beg-ink">{column.title}</h2>
            <ul className="grid gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[13px] text-beg-dim hover:text-beg-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/*
        Spec §12. Worth repeating on every page: BegFi is not Robinhood.
      */}
      <div className="safe-x mx-auto max-w-[1000px] pb-10">
        <p className="border-t border-beg-line pt-5 text-[12px] text-beg-dim">
          BegFi is not affiliated with Robinhood. Nothing on this site is financial advice. BegFi never
          holds your funds and cannot reverse a transaction.
        </p>
      </div>
    </footer>
  );
}
