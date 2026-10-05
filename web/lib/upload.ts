"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Image uploads, for avatars and token logos.
 *
 * WHERE FILES LIVE. Supabase Storage, in buckets created by migration 0006 —
 * never Vercel Blob. One place for files and one place for records, so a backup,
 * a deletion or a permission change is a single act rather than two.
 *
 * WHO CAN WRITE WHAT. The uploader's user id becomes the first folder in the
 * path, and the bucket's policy compares that folder against the session. So the
 * path is not cosmetic: `<uid>/<random>.png` is writable by that account and by
 * nobody else, and no column has to be trusted to make that true.
 *
 * WHAT IS CHECKED HERE. Type and size, for a fast, specific error — "that's a
 * 4MB file and the limit is 2MB" beats a policy rejection after a slow upload.
 * The bucket enforces the same limits regardless, because a client-side check is
 * a courtesy to the user and never a control.
 */
export type Bucket = "avatars" | "token-logos";

export const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  // Fall back to the MIME type, for a camera roll file with no useful name.
  const fromType = file.type.split("/")[1];
  return fromType === "jpeg" ? "jpg" : (fromType ?? "png");
}

export async function uploadImage(
  bucket: Bucket,
  file: File,
  userId: string,
): Promise<UploadResult> {
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "That needs to be a PNG, JPG, WebP or GIF." };
  }

  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, error: `That's ${mb}MB. The limit is 2MB.` };
  }

  const supabase = createClient();

  /*
   * A random name rather than the original. Two people uploading `logo.png`
   * would otherwise collide, and an earlier upload would be replaced by a later
   * one at the same URL — silently, and after the first person had already
   * shared the link. Cache-busting fall out of this for free: a new upload is a
   * new URL, so a browser cannot serve the old picture.
   */
  const name = `${userId}/${crypto.randomUUID()}.${extensionFor(file)}`;

  const { error } = await supabase.storage.from(bucket).upload(name, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type,
  });

  // Read, not caught: supabase-js returns errors rather than throwing.
  if (error) {
    return { ok: false, error: "Couldn't upload that. Try again." };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(name);
  if (!data?.publicUrl) {
    return { ok: false, error: "Uploaded, but couldn't get the link." };
  }

  return { ok: true, url: data.publicUrl };
}
