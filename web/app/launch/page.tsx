import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = { title: "Launch a token" };

/**
 * Not open, and it says so.
 *
 * Spec §9.5 describes this page as a form with three fields and a fee split
 * shown before confirming. None of that can exist yet: there is no audited
 * splitter, no token platform integration, and no $BEG to fund a growth fund
 * with. Rendering the form anyway — greyed out, or filling itself with a
 * simulated split — would be presenting a launchpad that cannot launch.
 *
 * Deliberately a static page: there is nothing to personalise and no reason for
 * it to be rendered per request.
 */
export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />
      <main className="grid max-w-[62ch] gap-6 py-11">
        <h1 className="text-[clamp(36px,8vw,64px)] font-extrabold leading-[.95] tracking-[-.05em]">
          Launch a token
        </h1>

        <div className="rounded-3xl border-[1.5px] border-dashed border-beg-line p-6">
          <p className="text-lg font-bold text-beg-ink">Not open yet.</p>
          <p className="mt-2 text-beg-dim">
            Launching needs three things that do not exist yet: the splitter contract has to be audited
            before it holds anyone&apos;s fees, a launch platform has to be integrated, and $BEG has to
            exist to be the currency of the thing.
          </p>
          <p className="mt-3 text-[13px] text-beg-dim">
            The intended fee split is on the{" "}
            <Link href="/" className="text-beg-ink underline underline-offset-2">
              home page
            </Link>
            . It is a plan, not terms.
          </p>
        </div>

        <p className="text-[13px] text-beg-dim">
          Anyone can launch a token on Robinhood Chain through other platforms. Tokens launched there
          are not affiliated with BegFi, and BegFi endorses nothing.
        </p>
      </main>
    </div>
  );
}
