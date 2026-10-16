import { NextResponse } from "next/server";
import { z } from "zod";

import { manageDrop } from "@/lib/drops";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  dropId: z.string().uuid(),
  action: z.enum(["pause", "resume", "end", "extend"]),
  /** Only for `extend`: an ISO time, or empty to clear the deadline. */
  closesAt: z.string().trim().optional(),
});

/**
 * POST /api/drop/update — the owner's controls.
 *
 * Pause stops NEW claims while accepted claims still get paid; resume opens it
 * again; end is final and releases the token lease; extend moves the deadline.
 * The prize, the token and the cap are deliberately NOT editable — a claim is a
 * promise made at a moment, and the row carries the prize it was made for (see
 * lib/drops.ts for the argument).
 *
 * Ownership is re-checked inside `manageDrop` against the session, so the id in
 * the body can never act on somebody else's drop.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid change." }, { status: 400 });
  }

  const result = await manageDrop(profile.id, {
    dropId: parsed.data.dropId,
    action: parsed.data.action,
    closesAt: parsed.data.closesAt,
  });
  return "error" in result
    ? NextResponse.json({ error: result.error }, { status: result.status })
    : NextResponse.json({ ok: true });
}
