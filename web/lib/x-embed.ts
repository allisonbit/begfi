import "server-only";

/**
 * THE SITE'S ONE POST READER.
 *
 * Extracted from the profile's X-verify route so every feature that must
 * "read a post" does it through this single mechanism: X's public oEmbed
 * endpoint — no API key, no OAuth, the read we already rely on. A post is
 * either caught here or the caller reports a transient failure honestly.
 */
export type ReadXPost = { author: string; text: string };

export async function readXPost(postUrl: string): Promise<ReadXPost | null> {
  try {
    const url = `https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&omit_script=1&dnt=true&theme=dark`;
    const res = await fetch(url, {
      headers: { "user-agent": "BegFi/1.0 (verification)" },
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { author_url?: string; html?: string } | null;
    if (!body) return null;
    // author_url is the profile URL (https://x.com/<handle>); the last
    // segment is the handle, whatever the scheme of the moment is.
    const author = body.author_url?.replace(/\/+$/, "").split("/").pop() ?? "";
    if (!author) return null;
    return { author, text: body.html ?? "" };
  } catch {
    return null;
  }
}

/** Whether a post's TEXT carries the required mention/hashtag, case-insensitively. */
export function postCarriesEntry(text: string, entry: string): boolean {
  return text.toLowerCase().includes(entry.toLowerCase());
}
