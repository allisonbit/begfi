"use client";

import Link from "next/link";
import { formatAmount } from "@/lib/erc20";

/**
 * The receipt's one tap back: tip the same person again.
 *
 * Nothing pre-signed, nothing automatic — a transfer still needs the sender's
 * own wallet to sign, which is the boundary that keeps BegFi noncustodial.
 * This button only carries you to the payment page with the last send's amount
 * already in the box, because the resolve-to-send loop is the point: someone
 * lands here, one press, wallet, done.
 */
export function TipBackButton({ username, amount }: { username: string; amount: string }) {
  // The exact amount read from base units, formatted for humans: the tip-back
  // prefill says what the original tip was, never a rounded neighbor of it.
  const tip = formatAmount(BigInt(amount));

  return (
    <Link
      href={`/${username}?tip=${tip}`}
      className="btn-primary mt-5 inline-block px-6 py-3 text-[16px]"
    >
      Tip @{username} back
    </Link>
  );
}
