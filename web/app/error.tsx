"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The error boundary for a route that threw.
 *
 * It says what happened in plain words and offers a retry, and it never claims
 * the underlying thing succeeded. The digest is shown because it is the one
 * value that lets an operator find the matching server log without asking the
 * visitor to describe what they saw. `message` is deliberately not rendered:
 * in production it is usually a minified string, and a stack trace on a money
 * page reads as a breach even when it is a network blip.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console only. No third-party error service is configured, and inventing
    // one here would ship a visitor's error text to somewhere unaccounted for.
    console.error(error);
  }, [error]);

  return (
    <div className="safe-x mx-auto flex min-h-[60vh] max-w-[640px] flex-col justify-center py-16">
      <p className="text-[12px] font-bold uppercase tracking-[.14em] text-beg-dim">Something broke</p>
      <h1 className="mt-2 text-[clamp(30px,7vw,48px)] font-extrabold leading-[1] tracking-[-.04em]">
        This page didn&apos;t load.
      </h1>
      <p className="mt-4 text-[15px] text-beg-dim">
        Nothing here confirms or moves money on its own. A failed page is a failed read — your balance and your links
        are unchanged. Try again, and if it keeps happening the digest below is what to send.
      </p>
      {error.digest ? <p className="mt-3 font-mono text-[12px] text-beg-dim">digest {error.digest}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="btn-primary px-4 py-2.5">
          Try again
        </button>
        <Link href="/transparency" className="btn-ghost px-4 py-2.5">
          Check the books
        </Link>
        <Link href="/" className="btn-ghost px-4 py-2.5">
          Home
        </Link>
      </div>
    </div>
  );
}
