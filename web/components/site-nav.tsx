"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HandCoins, LayoutGrid, Rocket, User } from "lucide-react";
import { SignInButton } from "@/components/sign-in-button";
import { useAuth } from "@/lib/auth-context";

/**
 * App-style chrome: a slim top bar and a bottom tab dock.
 *
 * The previous header stacked brand, four text links and an account action
 * across two rows on phones, which read as a website, not a product. Apps put
 * navigation at the thumb, so the four sections moved into a bottom dock:
 * a full-width bar on phones (thumb's edge) and a floating centered pill from
 * md up, where a bottom bar would imitate a phone on a monitor.
 *
 * SERVER-RENDERED LINKS, ALWAYS. Every link is a plain `Link`, none conditional
 * on hydration or on a wallet being connected. ONE CLEAR WAY IN: signed out the
 * top bar shows "Sign in"; only once signed in does the account chip appear,
 * because only then is there an account to manage.
 */

const links = [
  { href: "/begs", label: "Begs", Icon: HandCoins },
  { href: "/explore", label: "Tokens", Icon: LayoutGrid },
  { href: "/launch", label: "Launch", Icon: Rocket },
  { href: "/dashboard", label: "Dashboard", Icon: User },
] as const;

/** One dock tab: icon over label, active state via `aria-current`. */
function DockTab({ href, label, Icon }: { href: string; label: string; Icon: typeof Rocket }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex min-w-[64px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-bold transition-colors ${
        isActive ? "text-beg-lime" : "text-beg-dim hover:text-beg-ink"
      }`}
    >
      <Icon size={21} strokeWidth={isActive ? 2.4 : 2} aria-hidden className={isActive ? "animate-hop" : ""} />
      {label}
    </Link>
  );
}

/** The brand mark, shared by the bar and nothing else. */
function Brand() {
  return (
    <Link
      href="/"
      className="flex -rotate-2 items-baseline text-xl font-extrabold tracking-[-0.04em] text-beg-ink transition-transform duration-150 hover:scale-105"
      aria-label="BegFi home"
    >
      {/* The dot says the product is live before anyone reads a word. */}
      <span
        aria-hidden
        className="absolute -left-3 top-[3px] hidden size-[7px] rounded-full border border-beg-ink bg-beg-lime sm:block"
      />
      beg<span className="text-beg-blue">fi</span>
      <span aria-hidden className="caret" />
    </Link>
  );
}

/** The account action, shared by the bar on every breakpoint. */
function AccountAction() {
  const { profile, signedIn } = useAuth();

  if (profile) {
    return (
      <>
        <Link
          href="/dashboard"
          className="btn-ghost hidden px-3.5 py-2 text-[13px] font-bold text-beg-ink sm:inline-block"
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
    );
  }

  if (signedIn) {
    /*
     * Signed in, no username yet. A real state, and it needs its own action:
     * "Sign in" here would be a lie and would start a second sign-in for
     * someone already signed in — which is the loop that made usernames
     * impossible to claim.
     */
    return (
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
    );
  }

  /* Signed out: one action, which connects and signs in together. */
  return <SignInButton />;
}

/**
 * The top bar: brand and account only. Navigation lives at the thumb.
 */
export function SiteNav() {
  return (
    <header className="safe-top sticky top-0 z-40 border-b-[3px] border-beg-ink bg-beg-bg/90 backdrop-blur-md">
      <div className="safe-x mx-auto flex max-w-[1000px] items-center justify-between py-3">
        <Brand />
        <div className="flex items-center gap-2">
          <AccountAction />
        </div>
      </div>
    </header>
  );
}

/**
 * The bottom tab dock. Full-width bar on phones; a floating centered pill
 * from md up, so it reads as a launcher rather than a phone bottom bar.
 */
export function SiteDock() {
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-beg-ink bg-beg-bg/95 backdrop-blur-md md:inset-x-auto md:bottom-5 md:left-1/2 md:-translate-x-1/2 md:rounded-full md:border-[3px] md:shadow-glow-strong"
    >
      <div className="safe-x mx-auto flex max-w-[420px] items-center justify-around md:px-2">
        {links.map(({ href, label, Icon }) => (
          <DockTab key={href} href={href} label={label} Icon={Icon} />
        ))}
      </div>
    </nav>
  );
}
