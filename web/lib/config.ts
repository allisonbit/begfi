import { isAddress, normaliseAddress } from "./chains";

/**
 * Deployed-address configuration, read from the environment.
 *
 * Every address is optional and validated. A malformed or absent value resolves
 * to null rather than to a broken string, and the UI is required to treat null
 * as "this is not configured" and say so — NOT as a reason to render a working
 * looking control that cannot work. That rule is the whole reason this file
 * exists: the app must never present a send button for a token that has no
 * address.
 */

const addr = (value: string | undefined): string | null =>
  isAddress(value) ? normaliseAddress(value!) : null;

/** The $BEG token. Null until $BEG is actually launched (spec §9.4 / §14). */
export const BEG_TOKEN_ADDRESS = addr(process.env.NEXT_PUBLIC_BEG_TOKEN_ADDRESS);

/**
 * True only when the app can really move $BEG. Gates the entire send flow and
 * the launch section. While false the product is honest about being unfinished
 * rather than simulating the parts that need a token.
 */
export const BEG_CONFIGURED = BEG_TOKEN_ADDRESS !== null;

/** Public origin, used to build shareable links and Open Graph URLs. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * The link prefix shown to users. Kept separate from SITE_URL because the
 * product domain (begfi.xyz) is not the deployment URL yet, and copy that
 * claims a domain the app is not served from would be a lie about where the
 * link goes.
 */
export const LINK_ORIGIN = process.env.NEXT_PUBLIC_LINK_ORIGIN ?? SITE_URL;

export const linkFor = (username: string) => `${LINK_ORIGIN}/${username}`;

/** Username rules (spec §8). One definition, used by client and server. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * Names that must not be claimable, because they would let a user impersonate
 * the product or a brand (spec §8, §12). The database holds the authoritative
 * list in `begfi.reserved_usernames`; this is only a fast client-side echo so
 * the availability field can reject the obvious cases without a round trip.
 */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "beg",
  "begfi",
  "dashboard",
  "help",
  "hood",
  "launch",
  "login",
  "logout",
  "official",
  "privacy",
  "robinhood",
  "root",
  "security",
  "settings",
  "signup",
  "staff",
  "support",
  "terms",
  "token",
  "about",
  "legal",
  "mod",
  "moderator",
]);

export const isReserved = (username: string) => RESERVED_USERNAMES.has(username.toLowerCase());
