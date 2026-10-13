import { NextResponse } from "next/server";

import { isPostUrl, getEarnSettings, countTodaySubmissions } from "@/lib/earn";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/submit — a post link, and nothing else.
 *
 * Every rule from the spec is enforced HERE, not just in the UI: session +
 * username, earn active, pool funded, daily limit, duplicate link, and the
 * URL shape itself. The UI mirrors these checks so the feedback is instant,
 * but a request that skips the UI runs into the same wall.
 *
 * The insert goes through the service role after the checks, the same way the
 * indexer writes: RLS already restricts browser-direct inserts; this route is
 * the one path a submission is allowed to exist through.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in to submit." }, { status: 401 });
  }
  if (!profile.username) {
    return NextResponse.json({ error: "Set your username first." }, { status: 403 });
  }

  const settings = await getEarnSettings();
  if (!settings) {
    return NextResponse.json({ error: "Earn is not configured yet." }, { status: 503 });
  }
  if (!settings.isActive) {
    return NextResponse.json({ error: "Earn is paused. Check back soon." }, { status: 423 });
  }
  if (settings.poolRemaining < settings.rewardPerPost) {
    return NextResponse.json({ error: "Rewards pool is empty, check back soon." }, { status: 409 });
  }

  let body: { post_url?: string } | null = null;
  try {
    body = (await request.json()) as { post_url?: string };
  } catch {
    body = null;
  }
  const postUrl = body?.post_url?.trim() ?? "";

  if (!isPostUrl(postUrl)) {
    return NextResponse.json({ error: "That is not an X post link. Paste a x.com/twitter.com status URL." }, { status: 400 });
  }

  const postedToday = await countTodaySubmissions(profile.id);
  if (postedToday >= settings.dailyLimit) {
    return NextResponse.json(
      { error: `Daily limit reached — ${settings.dailyLimit} submissions a day.` },
      { status: 429 },
    );
  }

  const admin = createAdminClient();

  const { data: duplicate } = await admin
    .from("earn_submissions")
    .select("id")
    .eq("post_url", postUrl)
    .maybeSingle<{ id: string }>();
  if (duplicate) {
    return NextResponse.json({ error: "This post was already submitted." }, { status: 409 });
  }

  const { error: insertError } = await admin.from("earn_submissions").insert({
    user_id: profile.id,
    username: profile.username,
    wallet_address: profile.wallet_address.toLowerCase(),
    post_url: postUrl,
    reward_amount: settings.rewardPerPost.toString(),
  });

  if (insertError) {
    // The unique index on post_url is a second line of defence; treat a
    // constraint hit like the duplicate check above.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "This post was already submitted." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not record that. Try again." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    remaining: Math.max(0, settings.dailyLimit - (postedToday + 1)),
  });
}
