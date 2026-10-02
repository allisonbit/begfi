"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

/**
 * Edit display name, bio and avatar (spec §4, §7.4).
 *
 * The bio is plain text and nothing here renders it as anything else. Spec §12:
 * a bio that could carry links or markup turns every profile page into a place
 * to phish from, and the fix is that the field cannot contain them — not that
 * the page escapes them carefully.
 *
 * The write goes through the browser client with the anon key, so RLS is what
 * actually enforces that a person can only edit their own row. There is no
 * server route here doing an authorisation check, and none is needed: the policy
 * `profiles_update_self` is the check.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

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
        })
        .eq("id", profile.id);

      if (updateError) {
        setError(updateError.message);
        setStatus("idle");
        return;
      }

      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2200);
    } catch {
      setError("Could not save that.");
      setStatus("idle");
    }
  }

  return (
    <div className="grid max-w-[560px] gap-4">
      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          placeholder={profile.username}
          className="rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime"
        />
        <span className="text-right text-[12px] text-beg-dim">{displayName.length}/40</span>
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
        <span className="text-right text-[12px] text-beg-dim">{bio.length}/160</span>
      </label>

      <p className="text-[13px] text-beg-dim">
        Your username is <span className="text-beg-ink">@{profile.username}</span> and cannot be
        changed — a link that could be renamed could be renamed out from under everyone holding it.
      </p>

      {error ? <p className="text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={status === "saving"}
        className="rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg disabled:opacity-40"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save"}
      </button>

      <p className="text-[13px] text-beg-dim">
        Avatar upload is not built yet — it needs a storage bucket. Set on the roadmap, not here.
      </p>
    </div>
  );
}
