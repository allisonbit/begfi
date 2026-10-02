import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = { title: "Privacy" };

/**
 * An honest description of what this app stores, which is short. Written as
 * facts about the schema rather than boilerplate: everything listed here can be
 * checked against `supabase/migrations/0001_begfi_schema.sql`.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />

      <main className="max-w-[62ch] py-11">
        <h1 className="mb-6 text-[clamp(36px,8vw,56px)] font-extrabold leading-[.95] tracking-[-.05em]">
          Privacy
        </h1>

        <div className="space-y-5 text-beg-dim">
          <section>
            <h2 className="mb-2 font-bold text-beg-ink">What is stored</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your wallet address and username.</li>
              <li>A display name, bio and avatar if you add them. The bio is plain text.</li>
              <li>Transfers to and from your registered address, read from the chain.</li>
              <li>Reports you file, which are not readable by other users.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">What is not stored</h2>
            <p>
              No passwords, no email addresses, no private keys and no seed phrases. Sign-in is a wallet
              signature; BegFi never asks for anything that could move your funds.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">What is public</h2>
            <p>
              Your username, display name, bio, avatar, and the totals received: how much, and from how
              many distinct addresses. Individual transfers are visible only to the two parties involved,
              not to the public.
            </p>
            <p className="mt-2">
              The blockchain itself is public and permanent. Anything written on-chain can be read by
              anyone, forever, including after you stop using BegFi.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">Hiding a profile</h2>
            <p>
              Setting a profile to hidden removes it from this site. It does not and cannot remove
              anything from the blockchain.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
