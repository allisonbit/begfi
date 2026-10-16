import type { MetadataRoute } from "next";

/**
 * /manifest.webmanifest — the install identity of the app.
 *
 * WHY THIS EXISTS BEFORE A PLAY STORE LISTING. The plan wants BegFi on Google
 * Play. The honest first step is not a store account, it is this file: a
 * manifest plus the icons the app already ships is what turns a browser tab
 * into an icon on a phone's home screen, with no store, no review queue and no
 * build step. A store listing is a distribution channel for something people
 * already want to reopen; this is how we find out whether they do.
 *
 * The colour values are not invented here — they are the same two the layout's
 * viewport already declares (`themeColor: #fff3d6` on the cream ground the
 * whole product is drawn on), so the OS chrome and the app cannot disagree.
 *
 * `display: "standalone"` rather than `"fullscreen"`: losing the status bar
 * hides the time and the battery from someone checking a payment has gone
 * through, and the site has a dock that already reserves its own strip.
 *
 * The icons are the ones Next serves from `app/icon.png` (512×512) and
 * `app/apple-icon.png` (180×180). They are referenced at their real sizes on
 * purpose: a manifest that claims a size the file is not makes a launcher
 * rescale a bitmap and produces a soft icon on whatever the user's home screen
 * happens to be.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BegFi",
    short_name: "BegFi",
    description:
      "Ask for crypto, give crypto away, or run a campaign — in under a minute, with one link, on Robinhood Chain.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fff3d6",
    theme_color: "#fff3d6",
    categories: ["finance", "social"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
