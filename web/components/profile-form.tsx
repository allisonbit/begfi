"use client";

import { useState } from "react";
import { ImageUpload } from "@/components/image-upload";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

/**
 * The X verification flow: prove the handle on the profile is yours by posting
 * a one-use code from that account and pasting the post's link back.
 *
 * The section only shows while the field on the form matches the SAVED handle,
 * because verification proves the handle the profile already displays — a
 * typed-but-unsaved rename has no tick to hand out yet. Changing or clearing
 * the handle on save revokes the tick (see `save`), and the challenge code is
 * single-use on the server, so the honest life of a verification is exactly:
 * code → post → confirm → tick → survives until the handle changes.
 */
function VerifyX({ handle }: { handle: string }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "checking" | "verified">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/x-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; code?: string; error?: string }
        | null;
      if (res.ok && body?.ok && body.code) {
        setCode(body.code);
        setPhase("waiting");
      } else {
        setError(body?.error ?? "Could not start verification. Try again.");
      }
    } catch {
      setError("Network problem — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!code) return;
    setBusy(true);
    setError(null);
    setPhase("checking");
    try {
      const res = await fetch("/api/profile/x-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm", post_url: postUrl.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setPhase("verified");
      } else {
        // A failed check keeps the code: the person fixes what was wrong (the
        // account, the missing code) and tries the same challenge again.
        setPhase("waiting");
        setError(body?.error ?? "Check failed. Try again.");
      }
    } catch {
      setPhase("waiting");
      setError("Network problem — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "verified") {
    return (
      <p className="rounded-2xl border-[1.5px] border-beg-lime p-3 text-[13px] text-beg-ink">
        ✔️ @{handle} is verified. The tick shows on your public profile until you change or clear
        the username.
      </p>
    );
  }

  if (phase === "idle") {
    return (
      <div className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-dim">
        Want the ✔️ tick next to your X link? Post a one-time code from that account and paste the
        link back here.
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="ml-1 font-bold text-beg-ink underline decoration-beg-lime decoration-2 disabled:opacity-40"
        >
          Start verification
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-dim">
      <p>
        Post <span className="font-mono font-bold text-beg-ink">{code}</span> from{" "}
        <span className="text-beg-ink">@{handle}</span>, then paste the post&apos;s link here.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (code) void navigator.clipboard.writeText(code).catch(() => {});
          }}
          className="rounded-full border-[1.5px] border-beg-line px-3 py-1 font-bold text-beg-ink"
        >
          Copy code
        </button>
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(code ?? "")}`}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-full bg-beg-lime px-3 py-1 font-bold text-beg-ink"
        >
          Post it on X
        </a>
      </div>
      <input
        value={postUrl}
        onChange={(e) => {
          setPostUrl(e.target.value);
          setError(null);
        }}
        placeholder="https://x.com/yourhandle/status/…"
        inputMode="url"
        spellCheck={false}
        className="mt-2 w-full rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-2.5 text-beg-ink outline-none focus:border-beg-lime"
      />
      {error ? <p className="mt-1.5 text-beg-ink">{error}</p> : null}
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={busy || !postUrl.trim()}
        className="btn-primary mt-2 px-4 py-2 disabled:opacity-40"
      >
        {busy ? "Checking…" : "Verify"}
      </button>
    </div>
  );
}

/**
 * Edit your avatar, display name, bio and X handle (spec §4, §7.4).
 *
 * WHAT CANNOT BE CHANGED, AND WHY. The username is permanent. A link that could
 * be renamed is a link that can be renamed out from under everyone holding it —
 * and in a product whose main risk is impersonation, a name that changes identity
 * after the fact is worse than one that was taken. The form says so rather than
 * showing a disabled input, because a greyed-out field invites people to try.
 *
 * The bio is plain text and nothing renders it as anything else. Spec §12: a bio
 * that could carry links or markup turns every profile page into a place to phish
 * from, and the fix is that the field cannot contain them — not that each renderer
 * escapes them carefully.
 *
 * THE X HANDLE IS STORED AS A HANDLE, NOT A URL. People paste `@name`, `name` and
 * `https://x.com/name` interchangeably, so one is stripped to the others here and
 * the bare handle is what is saved. Storing whatever was typed would mean the
 * profile page had to guess at render time, and a stored URL that later went
 * somewhere else would be a link off this site that nobody vetted.
 *
 * Writes go through the browser client with the anon key, so RLS is what actually
 * enforces that a person can only edit their own row. There is no authorisation
 * check in this file, and none is needed: `profiles_update_self` is the check.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [xHandle, setXHandle] = useState(profile.x_handle ?? "");
  const [telegramHandle, setTelegramHandle] = useState(profile.telegram_handle ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.website_url ?? "");
  // Verification is tied to the SAVED handle: an edit on the form does not
  // touch it, and saving a different handle clears it with the challenge code
  // (see `save`). What the form shows derives from the row, never from a
  // second copy that could disagree with it.
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  /** Anything a person might paste, reduced to the handle itself. */
  function cleanHandle(raw: string): string {
    return raw
      .trim()
      .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "")
      .replace(/[^A-Za-z0-9_]/g, "")
      .slice(0, 15);
  }

  async function save() {
    setError(null);
    setStatus("saving");

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
          x_handle: cleanHandle(xHandle) || null,
          telegram_handle: telegramHandle.trim().replace(/^@/, "") || null,
          website_url: websiteUrl.trim() || null,
          // Changing or clearing the handle revokes the tick: it belonged to
          // the handle it was verified against, not to the person. Spend the
          // outstanding challenge code with it.
          ...(cleanHandle(xHandle) !== (profile.x_handle ?? "")
            ? { x_verified_at: null, x_verify_code: null }
            : {}),
        })
        .eq("id", profile.id);

      if (updateError) {
        setError(updateError.message);
        setStatus("idle");
        return;
      }

      setXHandle(cleanHandle(xHandle));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2200);
    } catch {
      setError("Could not save that.");
      setStatus("idle");
    }
  }

  return (
    <div className="grid max-w-[560px] gap-4">
      {/*
        The avatar uploads immediately and the URL is saved with the rest, rather
        than the file being held until Save. Uploading and saving are different
        actions with different failure modes, and bundling them would mean a
        failed save losing the picture too.
      */}
      <ImageUpload
        bucket="avatars"
        userId={profile.id}
        value={avatarUrl}
        onChange={setAvatarUrl}
        label="Avatar"
        round
      />

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          placeholder={profile.username}
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className="text-right text-[12px] text-beg-dim">{displayName.length} of 40</span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          rows={3}
          placeholder="Plain text only."
          className="resize-none rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className="text-right text-[12px] text-beg-dim">{bio.length} of 160</span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">X username</span>
        <div className="flex items-center gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 focus-within:border-beg-lime">
          <span className="text-[16px] font-bold text-beg-dim">@</span>
          <input
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            maxLength={40}
            placeholder="yourhandle"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim"
          />
        </div>
        <span className="text-[12px] text-beg-dim">
          Shown on your profile and on your begs, so people can find you. Paste a link or just the
          handle, it is tidied up either way.
        </span>
      </label>

      {/*
        The verify block appears only when the input matches the saved handle —
        what verification proves is the handle the profile already shows. While
        the two differ (or the handle is new), saving comes first.
      */}
      {Boolean(profile.x_verified_at) && cleanHandle(xHandle) === (profile.x_handle ?? "") ? (
        <p className="rounded-2xl border-[1.5px] border-beg-lime p-3 text-[13px] text-beg-ink">
          ✔️ @{profile.x_handle} is verified. The tick shows on your public profile.
        </p>
      ) : cleanHandle(xHandle) !== "" && cleanHandle(xHandle) === (profile.x_handle ?? "") ? (
        <VerifyX handle={profile.x_handle!} />
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Telegram username</span>
        <div className="flex items-center gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 focus-within:border-beg-lime">
          <span className="text-[16px] font-bold text-beg-dim">@</span>
          <input
            value={telegramHandle}
            onChange={(e) => setTelegramHandle(e.target.value)}
            maxLength={40}
            placeholder="yourhandle"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim"
          />
        </div>
        <span className="text-[12px] text-beg-dim">Optional. Shown as a link on your public profile.</span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Website</span>
        <input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          maxLength={120}
          placeholder="https://yoursite.xyz"
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className="text-[12px] text-beg-dim">Optional. Full URL, shown as a link on your public profile.</span>
      </label>

      <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-dim">
        Your username is <span className="text-beg-ink">@{profile.username}</span> and{" "}
        <span className="text-beg-ink">cannot be changed</span>. It is permanently attached to every
        link you have already shared, and a name that could move would be a way to impersonate the
        person who used to hold it.
      </p>

      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={status === "saving"}
        className="rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-ink disabled:opacity-40"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save"}
      </button>
    </div>
  );
}
