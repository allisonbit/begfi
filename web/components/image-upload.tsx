"use client";

import { useRef, useState } from "react";
import { MAX_BYTES, type Bucket, uploadImage } from "@/lib/upload";

/**
 * Pick an image and upload it.
 *
 * One control for both places that need one — a profile avatar and a token logo —
 * because they differ only in which bucket they land in. Written twice, the two
 * would drift on the file-size message, the accepted types, or the preview, and
 * only one of them would get fixed.
 *
 * The preview appears immediately from the local file, before the upload
 * finishes, so pressing the button feels like it did something. If the upload
 * then fails the preview is replaced by the error and the caller's value is left
 * untouched — a failed upload must never leave someone believing their picture
 * was saved.
 */
export function ImageUpload({
  bucket,
  userId,
  value,
  onChange,
  label,
  hint,
  round = false,
}: {
  bucket: Bucket;
  userId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  hint?: string;
  round?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = preview ?? value;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);

    // Show it straight away from the local file, before any network work.
    setPreview(URL.createObjectURL(file));
    setBusy(true);

    const result = await uploadImage(bucket, file, userId);

    if (result.ok) {
      onChange(result.url);
      setPreview(null);
    } else {
      setError(result.error);
      setPreview(null);
    }

    setBusy(false);
    // Allow re-picking the same file, which otherwise fires no change event.
    if (input.current) input.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <span className="text-[13px] text-beg-dim">{label}</span>

      <div className="flex items-center gap-4">
        <div
          className={`grid size-[72px] shrink-0 place-items-center overflow-hidden border-[1.5px] border-beg-line bg-beg-bg ${
            round ? "rounded-full" : "rounded-2xl"
          }`}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-[11px] text-beg-dim">none</span>
          )}
        </div>

        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-[13px] font-bold text-beg-ink transition-colors hover:border-beg-lime disabled:opacity-50"
            >
              {busy ? "Uploading…" : shown ? "Replace" : "Upload"}
            </button>

            {value && !busy ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setError(null);
                }}
                className="rounded-full px-3 py-2 text-[13px] text-beg-dim hover:text-beg-ink"
              >
                Remove
              </button>
            ) : null}
          </div>

          <span className="text-[12px] text-beg-dim">
            {hint ?? "PNG, JPG, WebP or GIF, up to 2MB."}
          </span>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {error ? <p className="text-[12px] text-beg-ink">{error}</p> : null}
    </div>
  );
}

export { MAX_BYTES };
