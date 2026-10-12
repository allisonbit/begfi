import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Notifications: list the caller's unread count and rows, and mark rows read.
 *
 * Written through the caller's session; RLS (`notifications_own`) is the
 * authorisation. Creation is service-role only (the cron route), so a client
 * cannot forge an alert, only read and acknowledge the real ones.
 */
const Body = z.object({
  action: z.literal("mark-read"),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await sb
    .from("notifications")
    .select("id, kind, title, body, payload, href, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: "Couldn't read notifications." }, { status: 503 });

  const rows = data ?? [];
  const unread = rows.filter((r) => r.read_at === null).length;

  return NextResponse.json({ ok: true, unread, rows });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That mark-read request doesn't parse." }, { status: 400 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", parsed.data.ids)
    .is("read_at", null);

  if (error) return NextResponse.json({ error: "Couldn't mark them read. Try again." }, { status: 503 });

  return NextResponse.json({ ok: true });
}
