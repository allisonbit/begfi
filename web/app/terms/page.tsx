import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

/**
 * Placeholder terms, written to state what is actually true today rather than to look complete.
 */
export default function TermsPage() {
  return (
    <div className="safe-x mx-auto max-w-[1000px]">

      <main className="max-w-[62ch] py-11">
        <h1 className="mb-6 text-[clamp(36px,8vw,56px)] font-extrabold leading-[.95] tracking-[-.05em]">
          Terms
        </h1>

        <div className="space-y-5 text-beg-dim">
          <p className="text-beg-ink">
            BegFi is not finished. Read this page as a description of what exists, not as a contract.
          </p>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">Nothing is custodial</h2>
            <p>
              BegFi never holds your funds. A send is an ERC-20 transfer signed in your own wallet,
              straight to the recipient&apos;s address. BegFi has no ability to reverse, refund, or move
              anything.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">$BEGFI has not been launched</h2>
            <p>
              There is no $BEGFI token. No contract exists, no address is deployed, and nothing on this
              site can send or receive it. Any page or account claiming otherwise is not us.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">The token</h2>
            <p>
              $BEGFI carries a 2% tax on token transfers, set at the token contract — not by BegFi.
              Tokens that trade on this chain are offered by third parties, and their presence here
              is not an endorsement, recommendation, or offer to sell.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">Usernames</h2>
            <p>
              A username points at a wallet address. It cannot be changed after it is claimed, and it
              does not prove identity. Always check the address shown next to a name before sending,
              because blockchain sends cannot be undone.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-bold text-beg-ink">No warranty</h2>
            <p>
              This software is provided as is, with no warranty of any kind. You are responsible for the
              transactions you sign.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
