import type { MetadataRoute } from "next";

import { SITE_URL, publicUrl } from "@/lib/config";

/**
 * /robots.txt.
 *
 * WHAT IS BLOCKED AND WHY SO LITTLE. Only two prefixes are disallowed, and both
 * are blocked because indexing them would be wrong rather than merely useless:
 *
 *  - `/dashboard` is per-user and behind a session. A crawler that reached it
 *    would index an empty signed-out shell and, worse, a search result that
 *    claims to be someone's earnings page.
 *  - `/api` is machine surface. Nothing there is a page, and letting a crawler
 *    wander it wastes the server's time on JSON.
 *
 * Everything else — every `/username`, `/beg/<id>`, `/earn/<slug>` and receipt
 * — is left open. That is a decision, not an oversight. Those pages are the
 * product, they are public by design, and one of them ranking for a person's
 * name or a project's campaign is worth more than any amount of careful
 * noindex hygiene. Blocking them to look tidy would hide the thing the site is
 * made of.
 *
 * The sitemap line is the part that does the work: it is how a crawler learns
 * that thousands of user pages exist at all, which nothing else on the site
 * tells it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/"],
      },
    ],
    sitemap: publicUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
