import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Launches" };
export const dynamic = "force-dynamic";

/**
 * Tokens you launched, and what you can claim.
 *
 * Empty, because the launchpad does not exist yet: there is no Pons integration,
 * no splitter deployed, and no token that could have been launched. Spec §9.5
 * says claimable fees must be read straight from the splitter contract rather
 * than from our database — so when this page does have content there will be no
 * number on it that BegFi itself is the source of.
 *
 * There is deliberately no "Claim fees" button. A button that cannot call
 * anything is the same class of lie as a fake balance.
 */
export default async function LaunchesPage() {
  await requireProfile();

  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />
      <main className="grid gap-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Launches</h1>
          <Link href="/dashboard" className="text-[13px] text-beg-dim underline underline-offset-2">
            Back to dashboard
          </Link>
        </header>

        <div className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          <p className="font-bold text-beg-ink">Nothing launched, and launching isn&apos;t open yet.</p>
          <p className="mt-1.5">
            The launchpad needs the splitter contract audited and a token platform integrated first.
            Until then there is nothing to launch and no fees to claim, so this page has no numbers on
            it rather than placeholder ones.
          </p>
        </div>
      </main>
    </div>
  );
}
