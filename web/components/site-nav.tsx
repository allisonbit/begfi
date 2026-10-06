"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";
import { useAuth } from "@/lib/auth-context";

/**
 * The site's primary navigation.
 *
 * SERVER-RENDERED LINKS, ALWAYS. Every link here is a plain `Link` — none is
 * conditional on hydration or on a wallet being connected. The previous version
 * put its only control in a div that stayed empty until JavaScript ran, so the
 * header read as a bare logo and the site had no way in.
 *
 * ONE CLEAR WAY IN. Signed out, the header shows "Sign in", which connects the
 * wallet and signs the message in a single press. Only once someone is signed in
 * does the wallet's own account chip appear, because only then is there an
 * account to manage.
 */
/**
 * One phone-safe nav link: prefix-matched active state via `aria-current`,
 * and `whitespace-nowrap` so a mobile label never wraps inside its pill.
 */
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[14px] font-bold transition-colors ${
        isActive ? "text-beg-lime" : "text-beg-dim hover:text-beg-ink"
      }`}
    >
      {label}
    </Link>
  );
}

export function SiteNav() {
  const { profile, signedIn } = useAuth();

  return (
    /*
      STICKY, not static: profile links get shared into DMs and timelines, so
      the nav travels with the scroll.

      TWO-ROW ON PHONES, ONE-ROW ON DESKTOP — one grid, no duplicated DOM.
      On a 360px phone nothing else fits beside four links plus an action, so
      brand and action share the top line and the links get their own row,
      which scrolls only if a future fifth link ever makes it necessary. From
      md up it relaxes into the classic brand | links | action line.
    */
    <header className="safe-top sticky top-0 z-40 border-b border-beg-line bg-beg-bg/80 backdrop-blur-md">
      <nav className="safe-x mx-auto grid max-w-[1000px] grid-cols-[auto_auto] items-center gap-x-4 gap-y-1 py-3 md:grid-cols-[auto_1fr_auto]">
        <Link
          href="/"
          className="relative flex items-baseline text-2xl font-extrabold tracking-[-0.04em] text-beg-ink md:col-start-1 md:row-start-1"
          aria-label="BegFi home"
        >
          {/* The dot says the product is live before anyone reads a word. */}
          <span
            aria-hidden
            className="absolute -left-3 top-[3px] hidden size-[7px] rounded-full bg-beg-lime shadow-glow sm:block"
          />
          beg<span className="text-beg-lime">fi</span>
          <span aria-hidden className="caret" />
        </Link>

        <ul
          className="col-span-2 -mx-1 flex items-center gap-0.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:col-span-1 md:col-start-2 md:row-start-1 md:overflow-visible"
        >
          {/*
            Shown signed out too, deliberately: hiding Dashboard until a wallet
            connects means a returning visitor cannot see the page exists.
          */}
          <li>
            <NavLink href="/begs" label="Begs" />
          </li>
          <li>
            <NavLink href="/explore" label="Tokens" />
          </li>
          <li>
            <NavLink href="/launch" label="Launch" />
          </li>
          <li>
            <NavLink href="/dashboard" label="Dashboard" />
          </li>
        </ul>

        <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-start-3">
          {profile ? (
            <>
              <Link
                href="/dashboard"
                className="hidden rounded-full border-[1.5px] border-beg-line px-3.5 py-2 text-[13px] font-bold text-beg-ink transition-colors hover:border-beg-lime sm:inline-block"
              >
                @{profile.username}
              </Link>
              {/* Signed in with a username: the wallet chip manages the account. */}
              <ConnectButton
                showBalance={false}
                chainStatus="icon"
                accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
              />
            </>
          ) : signedIn ? (
            /*
             * Signed in, no username yet. A real state, and it needs its own
             * action: "Sign in" here would be a lie and would start a second
             * sign-in for someone already signed in — which is the loop that made
             * usernames impossible to claim.
             */
            <>
              <Link href="/#claim" className="btn-primary px-4 py-2.5">
                Claim your link
              </Link>
              <ConnectButton
                showBalance={false}
                chainStatus="icon"
                accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
              />
            </>
          ) : (
            /* Signed out: one action, which connects and signs in together. */
            <SignInButton />
          )}
        </div>
      </nav>
    </header>
  );
}
