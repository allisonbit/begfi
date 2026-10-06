"use client";

import { useAccount } from "wagmi";
import { useAuth } from "@/lib/auth-context";
import { useWalletSignIn } from "@/lib/useWalletSignIn";

/**
 * Sign in with a wallet signature.
 *
 * WHY THIS EXISTS AS ITS OWN CONTROL. Connecting a wallet and signing in are two
 * different things here, and conflating them is what made the site look broken:
 *
 *   - Connecting hands the app an address. That is all. It proves nothing, and on
 *     its own it grants no session, so every signed-in page bounces you home.
 *   - Signing in asks the wallet to sign a free, gasless message. That is what
 *     creates the account and the session.
 *
 * The nav previously offered only "Connect wallet", so a person could connect,
 * press Dashboard, and be silently returned to the home page with no explanation
 * and no way to get in. There was no sign-in anywhere except one button on the
 * home page.
 *
 * This renders in three states:
 *   not connected        -> connect first (this button does both, in one press)
 *   connected, no session-> "Sign in", which runs the signature flow
 *   signed in            -> nothing; the nav shows the username instead
 */
export function SignInButton({ className = "" }: { className?: string }) {
  const { profile, refresh } = useAuth();
  const { isConnected } = useAccount();
  const { signIn, busy, error } = useWalletSignIn();

  if (profile) return null;

  async function run() {
    // A full navigation rather than a state update: the session is a cookie the
    // server sets, and the server-rendered pages have to see it. Refreshing
    // client state alone would leave the header showing "Sign in" on a page
    // whose content already assumed a session.
    const { error: failure, pending } = await signIn();
    // `pending`: the connect modal is open and the flow resumes on its own once
    // a wallet connects. Reloading here would kill the modal mid-flight.
    if (!failure && !pending) {
      await refresh();
      window.location.reload();
    }
  }

  /**
   * The button renders on the SERVER, before any JavaScript runs.
   *
   * It previously showed a grey skeleton until hydration, which meant the one
   * control a visitor needs did not exist in the HTML — the page looked like a
   * logo and nothing else, and anyone whose JavaScript failed never saw a way in
   * at all. A disabled button that says what it does beats a placeholder that
   * says nothing.
   *
   * It stays disabled until the auth context has resolved, so a signed-in
   * visitor cannot press a button that would start a sign-in they already have.
   */
  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="btn-primary px-4 py-2.5 disabled:opacity-50"
      >
        {busy ? "Check your wallet…" : isConnected ? "Sign in" : "Sign in"}
      </button>
      {error ? <span className="max-w-[240px] text-right text-[12px] text-beg-ink">{error}</span> : null}
    </span>
  );
}
