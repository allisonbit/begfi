import Link from "next/link";

/**
 * A 404 that offers the four products instead of an apology.
 *
 * Almost every not-found on this site is a username, a beg, a pay link or a
 * drop that was never claimed or has been retired. The visitor's intent is
 * still clear — they followed a link someone shared — so the page gives them
 * the live versions of the same four things rather than a dead end.
 */
export default function NotFound() {
  return (
    <div className="safe-x mx-auto flex min-h-[60vh] max-w-[640px] flex-col justify-center py-16">
      <p className="text-[12px] font-bold uppercase tracking-[.14em] text-beg-dim">404</p>
      <h1 className="mt-2 text-[clamp(32px,7vw,52px)] font-extrabold leading-[1] tracking-[-.04em]">
        This link isn&apos;t here.
      </h1>
      <p className="mt-4 text-[15px] text-beg-dim">
        The page may never have existed, or the person who shared it has retired it. Nothing was deleted from the
        chain — a link going quiet is not money going missing.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/begs" className="btn-primary px-4 py-2.5">
          Browse begs
        </Link>
        <Link href="/earn" className="btn-ghost px-4 py-2.5">
          Earn
        </Link>
        <Link href="/drops" className="btn-ghost px-4 py-2.5">
          Drops
        </Link>
        <Link href="/" className="btn-ghost px-4 py-2.5">
          Home
        </Link>
      </div>
    </div>
  );
}
