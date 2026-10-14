import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { getMessagesForTxs } from "@/lib/messages";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import type { Transfer } from "@/lib/types";

/**
 * The tip receipt — one confirmed $BEGFI transfer, framed as a thing to post.
 *
 * THE SHAPE. A receipt is a Transfer the indexer recorded — never the
 * browser's claim, and never anything a URL can conjure: a tx that does not
 * exist, or exists but carries no $BEGFI transfer, is a null and the page
 * shows exactly that. On-chain truth first, names second.
 */

export type Receipt = {
  tx_hash: string;
  from_wallet: string;
  to_wallet: string;
  amount: string;
  block_time: string;
  /** Sender/recipient names resolve to null when the wallet has no profile. */
  from_username: string | null;
  to_username: string | null;
  to_display_name: string | null;
  to_avatar_url: string | null;
  message: string | null;
  /** The recipient hid the message: the page shows that it did, not the text. */
  message_hidden: boolean;
};

const TX = /^0x[0-9a-fA-F]{64}$/;

export function isTxHash(value: string): boolean {
  return TX.test(value);
}

export async function getReceipt(txHash: string): Promise<Receipt | null> {
  if (!SUPABASE_CONFIGURED || !BEG_TOKEN_ADDRESS || !TX.test(txHash)) return null;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: logs, error } = await admin
    .from("transfers")
    .select("tx_hash, from_address, to_address, amount, block_time, token_address")
    .eq("tx_hash", txHash)
    .limit(10);

  if (error || !logs || !BEG_TOKEN_ADDRESS) return null;
  // A const alias, not a syntax trick: the filter closure below cannot see
  // the null-check through the function boundary, and the token address is
  // genuinely constant from here on.
  const tokenCa = BEG_TOKEN_ADDRESS;

  // This transaction's $BEGFI legs only; the tx may carry other events too.
  const begFfi = (logs as Array<Transfer & { token_address: string }>).filter(
    (l) => l.token_address.toLowerCase() === tokenCa.toLowerCase(),
  );

  // One transfer per receipt. Multi-leg txs (batched sends) get the FIRST
  // leg — the page is a receipt for one tip, not a statement, and the
  // explorer link is there for the whole truth.
  const row = begFfi[0];
  if (!row) return null;

  const wallets = [...new Set([row.from_address.toLowerCase(), row.to_address.toLowerCase()])];
  const { data: profiles } = await admin
    .from("profiles")
    .select("wallet_address, username, display_name, avatar_url, is_hidden")
    .in("wallet_address", wallets);
  const byWallet = new Map(
    (profiles ?? []).map((p) => [p.wallet_address as string, p as { username: string; display_name: string | null; avatar_url: string | null; is_hidden: boolean }]),
  );

  const to = byWallet.get(row.to_address.toLowerCase()) ?? null;
  const from = byWallet.get(row.from_address.toLowerCase()) ?? null;

  // Hidden stays hidden: the message belongs to the recipient to surface,
  // and a receipt page is public.
  const messageMap = await getMessagesForTxs([row.tx_hash], row.to_address.toLowerCase());
  const msg = messageMap.get(row.tx_hash);

  return {
    tx_hash: row.tx_hash,
    from_wallet: row.from_address,
    to_wallet: row.to_address,
    amount: row.amount,
    block_time: row.block_time,
    from_username: from?.username ?? null,
    to_username: to && !to.is_hidden ? to.username : null,
    to_display_name: to && !to.is_hidden ? to.display_name : null,
    to_avatar_url: to && !to.is_hidden ? to.avatar_url : null,
    message: msg?.message ?? null,
    message_hidden: Boolean(msg?.hiddenByRecipient),
  };
}
