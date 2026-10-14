import "server-only";

import { createPublicClient, http, parseAbiItem, toEventHash } from "viem";

import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Transfer messages — the sender's optional note with a $BEGFI send.
 *
 * THE ONE CONTRACT. A message can exist only for a transaction that the chain
 * can prove was a $BEGFI transfer to the recipient. The note is never trusted
 * from the browser alone; the API re-reads the Transfer log before it stores
 * anything.
 */

export type TransferMessage = {
  tx_hash: string;
  sender_wallet: string;
  recipient_wallet: string;
  message: string;
  hidden_by_recipient: boolean;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* The filter                                                          */
/* ------------------------------------------------------------------ */

/**
 * BASIC, NOT A CIVILISATION. A word list and obvious linkspam: the goal is
 * that nothing gross reaches a payment page by default, not jurisprudence.
 * Matched case-insensitively on word boundaries; leetspeak variants like
 * "a$$" are caught by the same alternation.
 */
const BANNED_PATTERNS = [
  /\bf[u*]ck(in[g]?)?\b/i,
  /\bsh[i*]t\b/i,
  /\bb[i1*]tch\b/i,
  /\bcu?nt\b/i,
  /\bn[i1*]gg/i,
  /\bf[a4*]g\b/i,
  /\br[a4*]pe\b/i,
  /\bdick\b/i,
  /\bc[o0]ck\b/i,
  /\bwh[o0]re\b/i,
  /\bscam\b/i,
  /^https?:\/\/(?!begfi\.io)/i, // off-site links out, links to begfi are fine
  /^(send|trade|join|buy)\s+(me|my|@)?\s*(more|more $BEGFI|crypto|token)/i,
];

export function messageProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Write the message first.";
  if (trimmed.length > 140) return "140 characters maximum.";
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "That message breaks the house rules. Try a different one.";
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* On-chain verification                                               */
/* ------------------------------------------------------------------ */

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** topic0 of the Transfer event, computed once. */
const TRANSFER_TOPIC0 = toEventHash(TRANSFER_EVENT);

/**
 * TRUE only when the chain says this tx is a $BEGFI Transfer with the given
 * (from, to). A receipt the indexer has not seen yet still verifies — the
 * chain is the source, not the database.
 */
export async function verifyTransferOnChain(
  txHash: string,
  from: string,
  to: string,
): Promise<boolean> {
  if (!BEG_TOKEN_ADDRESS) return false;
  try {
    const client = createPublicClient({ chain: robinhoodChain, transport: http() });
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") return false;

    const sender = from.toLowerCase();
    const recipient = to.toLowerCase();
    return receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === BEG_TOKEN_ADDRESS!.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC0 &&
        `0x${log.topics[1]!.slice(26)}`.toLowerCase() === sender &&
        `0x${log.topics[2]!.slice(26)}`.toLowerCase() === recipient,
    );
  } catch {
    // An unknown hash (still pending) or RPC failure verifies FALSE: the
    // message waits until the money provably moved.
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Messages for a set of transfer txs, visible ones only — EXCEPT when the
 * caller is the recipient, in which case hidden rows come back too so their
 * own dashboard still shows the whole story.
 */
export async function getMessagesForTxs(
  txHashes: string[],
  viewerWallet: string | null,
): Promise<Map<string, { message: string; hiddenByRecipient: boolean; isOwnHidden: boolean }>> {
  const out = new Map<string, { message: string; hiddenByRecipient: boolean; isOwnHidden: boolean }>();
  if (!SUPABASE_CONFIGURED || txHashes.length === 0) return out;
  const admin = createAdminClient();

  const { data } = await admin
    .from("transfer_messages")
    .select("tx_hash, sender_wallet, recipient_wallet, message, hidden_by_recipient")
    .in("tx_hash", txHashes)
    .limit(txHashes.length);

  const viewer = viewerWallet?.toLowerCase();
  for (const row of (data ?? []) as Array<{
    tx_hash: string;
    sender_wallet: string;
    recipient_wallet: string;
    message: string;
    hidden_by_recipient: boolean;
  }>) {
    const isRecipientViewer = viewer !== null && row.recipient_wallet === viewer;
    if (row.hidden_by_recipient && !isRecipientViewer) continue;
    out.set(row.tx_hash, {
      message: row.message,
      hiddenByRecipient: row.hidden_by_recipient,
      isOwnHidden: row.hidden_by_recipient && isRecipientViewer,
    });
  }
  return out;
}
