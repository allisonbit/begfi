import { NextResponse } from "next/server";
import { z } from "zod";

import { messageProblem, verifyTransferOnChain } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Attach = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "That transaction hash doesn't look right."),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Missing recipient address."),
  message: z.string(),
});

/**
 * POST /api/message — the sender's optional note, attached to a send.
 *
 * THE ORDER MATTERS. The session identifies the sender; the chain confirms
 * the transaction is a real $BEGFI transfer from that sender to that
 * recipient; the filter judges the text; only then does a row exist. A
 * message for money that never moved cannot be created, and a message whose
 * text breaks the rules is refused before it is stored.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Messages are not available yet." }, { status: 503 });
  }

  const parsed = Attach.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That isn't a valid message." },
      { status: 400 },
    );
  }

  const problem = messageProblem(parsed.data.message);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const sender = profile.wallet_address.toLowerCase();
  const recipient = parsed.data.recipient.toLowerCase();
  if (sender === recipient) {
    return NextResponse.json({ error: "You cannot message yourself." }, { status: 400 });
  }

  const verified = await verifyTransferOnChain(parsed.data.tx_hash, sender, recipient);
  if (!verified) {
    return NextResponse.json(
      { error: "The chain does not show this send yet. The message attaches once the transfer is confirmed." },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("transfer_messages").upsert({
    tx_hash: parsed.data.tx_hash,
    sender_wallet: sender,
    recipient_wallet: recipient,
    message: parsed.data.message.trim(),
  });

  if (error) {
    return NextResponse.json({ error: "Could not save the message. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

const Hide = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  hidden: z.boolean(),
});

/**
 * PUT /api/message — the recipient's hide switch.
 *
 * Only the recipient of a message may hide or unhide it. Hiding removes the
 * row from every public feed and supporter list; their own dashboard keeps
 * showing it, marked, because hiding is curation, not deletion.
 */
export async function PUT(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Messages are not available yet." }, { status: 503 });
  }

  const parsed = Hide.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid request." }, { status: 400 });
  }

  const admin = createAdminClient();
  // The WHERE carries the ownership: a wallet can only ever flip the switch
  // on a message addressed to it.
  const { error } = await admin
    .from("transfer_messages")
    .update({ hidden_by_recipient: parsed.data.hidden })
    .eq("tx_hash", parsed.data.tx_hash)
    .eq("recipient_wallet", profile.wallet_address.toLowerCase());

  if (error) {
    return NextResponse.json({ error: "Could not update that message." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
