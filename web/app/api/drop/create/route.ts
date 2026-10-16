import { NextResponse } from "next/server";

import { DropDraft, createDrop } from "@/lib/drops";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = DropDraft;

/**
 * POST /api/drop/create — start a giveaway.
 *
 * Owner identity is the session, the prize is converted against the token's OWN
 * decimals (read from its contract inside `createDrop`), and the token's
 * exclusivity is decided by the database's lease trigger rather than by this
 * route's read. Nothing about who gets paid or how much comes from the client.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the drop fields." }, { status: 400 });
  }

  const result = await createDrop(profile.id, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, id: result.id ?? null });
}
