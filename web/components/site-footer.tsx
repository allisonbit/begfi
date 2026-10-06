import Link from "next/link";

/**
 * The site footer.
 *
 * Real links, in one place, on every page. Before this, `/terms` was the only
 * link anywhere on the home page and the footer was a line of text — so a visitor
 * who wanted to launch or explore had nothing to press.
 */
const COLUMNS = [
  {
    title: "BegFi",
    links: [
      { href: "/", label: "Home" },
      { href: "/begs", label: "Begs" },
      { href: "/explore", label: "Explore tokens" },
      { href: "/launch", label: "Launch a token" },
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
    <footer className="mt-auto border-t border-beg-line">
      <div className="safe-x mx-auto grid max-w-[1000px] gap-8 py-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
            beg<span className="text-beg-lime">fi</span>
          </span>
          <p className="mt-3 max-w-[28ch] text-[13px] text-beg-dim">
            Non-custodial $BEG payment links and token launches on Robinhood Chain.
          </p>
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
        Spec §12 and §2. Worth repeating on every page: BegFi is not Robinhood,
        and anyone can launch a token through this site.
      */}
      <div className="safe-x mx-auto max-w-[1000px] pb-10">
        <p className="border-t border-beg-line pt-5 text-[12px] text-beg-dim">
          BegFi is not affiliated with Robinhood. Anyone can launch a token through this site and
          none of them are endorsed here. Nothing on this site is financial advice. BegFi never
          holds your funds and cannot reverse a transaction.
        </p>
      </div>
    </footer>
  );
}
