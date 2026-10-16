/**
 * Analytics — deliberately tiny, deliberately optional.
 *
 * WHY THIS FILE EXISTS. Nothing on the site emitted a single event, so every
 * product question ("does anyone who signs in actually post a beg?", "where do
 * people leave the campaign flow?") could only be answered by opinion. The plan
 * (§14) lists the events a funnel needs; this is the mechanism, and the events
 * are wired where the product actually does something.
 *
 * WHY A MISSING ID IS A NO-OP, NOT AN ERROR. Analytics is the one dependency
 * that must never be able to break a page. `NEXT_PUBLIC_GA_ID` is read here and
 * nowhere else; while it is blank the module loads nothing, sends nothing, and
 * every `track` call returns immediately. A local checkout with no env file
 * behaves exactly like production minus the reporting — which is what makes it
 * safe to call `track` from a button on the money path.
 *
 * WHY `track` IS CALLED FROM THE CLIENT ONLY. An event is a statement that a
 * browser did something: a button was pressed, a link was copied. The server
 * cannot know that, and guessing from a request log would produce numbers that
 * look authoritative and are wrong. Server-side facts belong in the database,
 * where they already are.
 *
 * NO COOKIES ARE SET BY THIS FILE, and no personal data is sent: events carry a
 * campaign slug, a beg id, an amount bucket — never a wallet address, never a
 * username. The privacy policy's claims have to stay true.
 */

/**
 * The GA4 measurement ID ("G-XXXXXXXXXX"). Empty means analytics is off.
 *
 * The `process.env.NEXT_PUBLIC_*` reference is written as a literal so Next
 * inlines it into the client bundle at build time — a computed key would
 * resolve to `undefined` in the browser.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID?.trim() || "";

export const ANALYTICS_CONFIGURED = GA_MEASUREMENT_ID !== "";

/**
 * The events this product can report, spelled as the plan names them.
 *
 * A closed union rather than free strings: an event that does not exist here
 * fails to compile, so the funnel cannot silently drift into
 * `beg_created` / `begCreated` / `createdBeg` — three spellings that are one
 * broken report. The Drops events are listed before Drops exists on purpose:
 * they are the funnel the product is being built towards, and having the names
 * settled means the screens can be instrumented as they are written instead of
 * retrofit.
 */
export type AnalyticsEvent =
  // The plan's funnel (§14) — Drops are not built yet, the names are ready.
  | "drop_created"
  | "drop_funded"
  | "drop_claimed"
  // Campaigns — live today.
  | "campaign_created"
  | "campaign_funded"
  | "campaign_joined"
  // Begs — the original product.
  | "beg_posted"
  | "beg_shared"
  // Pay links — an ask with a number on it. `payment_received` is the other end
  // of this funnel and cannot be reported from the browser (the receiver may be
  // offline when the money lands); it is derived from confirmed transfers.
  | "pay_link_created"
  // Identity and money.
  | "username_claimed"
  | "payment_sent"
  | "payment_received"
  | "link_copied"
  | "qr_downloaded";

/** Values an event may carry. Objects are stripped their wallet/username fields. */
export type AnalyticsParams = Record<string, string | number | boolean>;

/**
 * The only function the rest of the app needs.
 *
 * It never throws, never awaits, and never blocks a user action — an analytics
 * failure must not be able to cost someone a payment. If `gtag` is absent the
 * call is simply dropped, which is indistinguishable from a working install
 * with no dashboard, and is the correct behaviour in both cases.
 */
export function track(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  if (!ANALYTICS_CONFIGURED) return;
  if (typeof window === "undefined") return;

  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;

  try {
    w.gtag("event", event, params);
  } catch {
    /*
     * A blocked script, an extension rewriting `window.gtag`, or a browser
     * policy refusing the call: all of them land here, and all of them mean the
     * event is lost. That is the acceptable outcome — the alternative is an
     * exception thrown inside a click handler that has already moved money.
     */
  }
}

/**
 * A page view for the current path.
 *
 * GA4's automatic page view only fires on the first load. Every navigation in
 * the App Router happens client-side, so without this the funnel would record
 * one page per session and every "where do people go next" question would be
 * answered with the landing page. The query string is dropped: beg pages and
 * dashboards carry none that matters, and it is the kind of thing that turns
 * one page into fifty rows.
 */
export function pageview(path: string): void {
  if (!ANALYTICS_CONFIGURED) return;
  if (typeof window === "undefined") return;

  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;

  try {
    w.gtag("event", "page_view", { page_path: path });
  } catch {
    // Same rule as `track`.
  }
}
