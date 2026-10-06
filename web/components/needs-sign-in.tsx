import { SignInButton } from "@/components/sign-in-button";

/**
 * What a signed-in page shows someone who is not signed in.
 *
 * Previously these pages redirected. A redirect from a page you deliberately
 * navigated to is indistinguishable from a broken button — which is exactly how
 * this looked: connect a wallet, press Dashboard, land back on the home page with
 * no explanation. Saying what is missing and offering the way in is the whole
 * difference between "this is broken" and "I know what to do next".
 */
export function NeedsSignIn({ what }: { what: string }) {
  return (
    <div className="mx-auto grid max-w-[520px] gap-5 py-16 text-center">
      <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.04em]">
        Sign in to see {what}
      </h1>

      <p className="text-beg-dim">
        BegFi has no passwords and no email. Signing in is a free signature from your wallet — it
        costs no gas and sends no transaction. It is how the site knows which link is yours.
      </p>

      <div className="flex justify-center">
        <SignInButton />
      </div>

      <p className="text-[13px] text-beg-dim">
        Connecting a wallet on its own is not signing in. Connecting hands the site an address;
        signing the message is what creates your account.
      </p>
    </div>
  );
}

/**
 * Shown when a session exists but no username has been claimed.
 *
 * A real state, and a distinct one: the wallet signed in, so there is an account,
 * but there is no link yet and nothing for a dashboard to show. Sending this
 * person to the claim step is right; showing them zeros would be accurate and
 * useless.
 */
export function NeedsUsername() {
  return (
    <div className="mx-auto grid max-w-[520px] gap-5 py-16 text-center">
      <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.04em]">
        Claim your link
      </h1>

      <p className="text-beg-dim">
        You&apos;re signed in, but you haven&apos;t picked a username yet. That username is your
        payment link — the thing people open to send you $BEG.
      </p>

      <a
        href="/#claim"
        className="btn-primary mx-auto px-6 py-3.5"
      >
        Pick a username
      </a>
    </div>
  );
}
