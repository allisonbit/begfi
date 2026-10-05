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
const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch" },
];

export function SiteNav() {
  const { profile } = useAuth();
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="border-b border-beg-line">
      <nav className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink"
            aria-label="BegFi home"
          >
            beg<span className="text-beg-lime">fi</span>
          </Link>

          <ul className="flex items-center gap-0.5">
            {LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={`rounded-full px-3 py-2 text-[14px] font-bold transition-colors ${
                    isActive(href) ? "text-beg-lime" : "text-beg-dim hover:text-beg-ink"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
            {/*
              Shown signed out too, deliberately: hiding it until a wallet
              connects means a returning visitor cannot see the page exists. The
              page itself explains how to get in rather than bouncing them.
            */}
            <li>
              <Link
                href="/dashboard"
                aria-current={isActive("/dashboard") ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-[14px] font-bold transition-colors ${
                  isActive("/dashboard") ? "text-beg-lime" : "text-beg-dim hover:text-beg-ink"
                }`}
              >
                Dashboard
              </Link>
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-2">
          {profile ? (
            <>
              <Link
                href="/dashboard"
                className="hidden rounded-full border-[1.5px] border-beg-line px-3.5 py-2 text-[13px] font-bold text-beg-ink transition-colors hover:border-beg-lime sm:inline-block"
              >
                @{profile.username}
              </Link>
              {/* Signed in: the wallet chip is for switching accounts and networks. */}
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
