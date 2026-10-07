"use client";

import { useState } from "react";
import { ImageUpload } from "@/components/image-upload";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

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
