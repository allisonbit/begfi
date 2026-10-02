"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

/**
 * The one nav for the whole product.
 *
 * Two different things live here on purpose (see `useWalletSignIn`): being signed
 * in, and having a wallet connected. The account chip on the right shows the
 * signed-in username or a sign-in link; RainbowKit's own button next to it shows
 * the wallet. Collapsing them into one control is how a person ends up not
 * knowing which of the two they have done.
 */
export function SiteNav() {
  const { profile, loading } = useAuth();

  return (
    <nav className="flex items-center justify-between gap-4 py-4 safe-x">
      <Link href="/" className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
        beg<span className="text-beg-lime">fi</span>
      </Link>

      <div className="flex items-center gap-2">
        {loading ? null : profile ? (
          <Link
            href="/dashboard"
            className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-sm font-bold text-beg-ink transition-colors hover:border-beg-lime"
          >
            @{profile.username}
          </Link>
        ) : null}

        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
        />
      </div>
    </nav>
  );
}
