import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * THE BELL IS THE OWNERS OF THE SITE.
 *
 * One insert, deduplicated on (profile, kind, ref) — the same ref rule the
 * indexer's bell uses, so a run that re-reads old windows re-bells nothing
 * and the same fact is never written twice. Every robotic "you got paid"
 * moment in the product routes through here so the bell's semantics stay
 * identical across features. Never a bare console.log — the user-visible
 * surface is the bell, so that is what the code writes to.
 */
export async function publishNotification(
  admin: AdminClient,
  input: {
    profileId: string;
    kind: string;
    title: string;
    body: string;
    ref: string;
    href?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("profile_id", input.profileId)
    .eq("kind", input.kind)
    .contains("payload", { ref: input.ref })
    .limit(1);
  if (existing && existing.length > 0) return false;

  const { error } = await admin.from("notifications").insert({
    profile_id: input.profileId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    payload: { ref: input.ref, ...(input.payload ?? {}) },
    href: input.href ?? null,
  });
  return !error;
}

/** The earner's "you got paid" row — the money arrived in their wallet, the bell tells them when it happened. */
export async function publishEarnerNotification(
  admin: AdminClient,
  input: {
    profileId: string;
    amount: string;
    decimals: number;
    symbol: string;
    txHash: string | null;
    campaignSlug?: string;
    refPrefix: string;
  },
): Promise<boolean> {
  const display = (BigInt(input.amount) / 10n ** BigInt(input.decimals)).toLocaleString("en-GB");
  return publishNotification(admin, {
    profileId: input.profileId,
    kind: "earn_payout",
    title: `You earned ${display} ${input.symbol}`,
    body: input.txHash
      ? "Paid to your wallet automatically — the transfer is confirmed on-chain. Keep posting to keep earning."
      : "Your payout is being sent automatically — it lands in your wallet within a minute or two.",
    ref: `${input.refPrefix}-${input.txHash ?? input.refPrefix}`,
    href: input.campaignSlug ? `/earn/${input.campaignSlug}` : "/dashboard/activity",
    payload: { tx: input.txHash ?? null, amount: input.amount, symbol: input.symbol },
  });
}
