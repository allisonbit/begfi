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

/**
 * The one wallet allowed to run BegFi's own genesis launch — the dev wallet for
 * $BEG (spec §9.2: 5% creator tax, all of it to the dev wallet).
 *
 * GENESIS OTHERWISE DEADLOCKS. The form used to lock genesis mode for everyone
 * "until $BEG exists", but $BEG comes into existence THROUGH a genesis launch:
 * the reservation, read absolutely, forbade the one launch it was reserving
 * space for. Naming the wallet in advance is the way out that keeps the
 * reservation honest — every other wallet still sees genesis locked, and this
 * address stops being special the moment $BEG exists, because a configured
 * token address locks genesis for everyone including the dev.
 *
 * The address is lowercase and compared lowercase. Set from the deployment
 * environment, like every other address in this file.
 */
export const GENESIS_LAUNCHER_WALLET =
  process.env.NEXT_PUBLIC_GENESIS_LAUNCHER_WALLET?.trim().toLowerCase() ||
  // The dev wallet in code, not only in the environment. It is public by
  // nature — the on-chain creator-fee recipient, readable from the token
  // record the moment $BEG exists — so a build cache that predates the env
  // var can never strand genesis mode behind a stale bundle. The env var
  // still wins where it is set.
  "0x38e2f47d9b2eb233c035dcbc2d40857d9517933a";

/**
 * Public origin, used to build shareable links and Open Graph URLs.
 *
 * Blank is treated as unset (`||`, not `??`), because `.env` files routinely
 * carry `KEY=""` for "not set here" and an empty `metadataBase` would produce
 * relative Open Graph URLs that no crawler can resolve.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(
  /\/$/,
  "",
);

/**
 * The link prefix shown to users and copied to the clipboard. Kept separate from
 * SITE_URL so the two can move independently — the product domain and the
 * serving domain do not have to change on the same day. Both are set to
 * https://begfi.io now that the domain is live; a deployment URL would show in
 * copy that claims a domain the app is not served from, which would be a lie
 * about where the link goes. Blank falls back to SITE_URL.
 */
export const LINK_ORIGIN = process.env.NEXT_PUBLIC_LINK_ORIGIN?.trim() || SITE_URL;

export const linkFor = (username: string) => `${LINK_ORIGIN}/${username}`;

/**
 * An absolute URL on the deployment site.
 *
 * Distinct from `linkFor`, which uses LINK_ORIGIN — the address people are told
 * their link lives at, which may be a domain the app is not yet served from.
 * This one has to be genuinely reachable, because it goes to a crawler: an Open
 * Graph image URL that 404s produces a blank card on the post itself.
 */
export const publicUrl = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

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
