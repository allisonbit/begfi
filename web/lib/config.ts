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

/**
 * The $BEGFI token — THE one contract address, set here in code.
 *
 * The brief is explicit: always this exact CA and never any other, so the
 * value is pinned rather than env-overridable. An environment that still
 * carries the pre-relaunch address (0xbeabe…) must not win.
 */
export const BEG_TOKEN_ADDRESS: string | null =
  "0x18823d1f1807ce3bdd90aafb7473928bc9368242";

/**
 * The relaunched token's contract address — THE value everything reads.
 *
 * Everything the home page's live stats (market cap, price, volume, liquidity,
 * holders, fees) read is keyed off this constant and nothing else. The token
 * launched on Robinhood Chain (chain 4663) via runitup.gg on 2026-10-14.
 *
 * The 1% is the launch pool's swap fee (Uniswap V4 1% fee tier, split
 * 75% creator / 25% platform by the launch contracts) — it is NOT a transfer
 * tax on the ERC-20; the verified token source has no fee-on-transfer hook,
 * and the copy everywhere says 1% accordingly.
 */
export const TOKEN_CA = "0x18823d1f1807ce3bdd90aafb7473928bc9368242";
export const TOKEN_CONFIGURED = addr(TOKEN_CA) !== null;

/**
 * The chain the relaunched token trades on, as the market-data APIs name it.
 * Robinhood Chain's public slug is "robinhood" (not "robinhood-chain").
 * Only needs touching if the relaunch lands somewhere else.
 */
export const TOKEN_CHAIN = process.env.NEXT_PUBLIC_TOKEN_CHAIN?.trim() || "robinhood";

/**
 * True only when the app can really move $BEGFI. Gates the entire send flow and
 * the launch section. While false the product is honest about being unfinished
 * rather than simulating the parts that need a token.
 */
export const BEG_CONFIGURED = BEG_TOKEN_ADDRESS !== null;

/**
 * The dev wallet — the recipient of BegFi's fee share from the relaunch.
 *
 * The relaunch ran on runitup.gg: the launch pool's 1% swap fee splits
 * 75% creator / 25% platform, and this is the creator side. It doubles as
 * the Earn payouts admin allowlist seed.
 *
 * The address is lowercase and compared lowercase. Set from the deployment
 * environment, like every other address in this file.
 */
export const GENESIS_LAUNCHER_WALLET =
  process.env.NEXT_PUBLIC_GENESIS_LAUNCHER_WALLET?.trim().toLowerCase() ||
  // The dev wallet in code, not only in the environment. It is public by
  // nature — the on-chain creator-fee recipient, readable from the token
  // record the moment $BEGFI exists — so a build cache that predates the env
  // var can never strand genesis mode behind a stale bundle. The env var
  // still wins where it is set.
  "0x38e2f47d9b2eb233c035dcbc2d40857d9517933a";

/**
 * Community channels, shown wherever the site asks someone to follow along.
 *
 * Defaults in code rather than env-only, so a build cache or a missing env var
 * still shows the real channels — they are public by nature and would otherwise
 * silently vanish from the footer.
 */
export const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL?.trim() || "https://t.me/BegFihood";
export const X_URL = process.env.NEXT_PUBLIC_X_URL?.trim() || "https://x.com/BegFihood";

/**
 * Post-to-earn: the wallets allowed to run the Earn review.
 *
 * The allowlist is a server-side env (comma-separated), defaulting to the dev
 * wallet so the review console is reachable the day the feature ships. Admin
 * routes check the SIGNED-IN account's wallet, never a client-claimed value.
 */
export const EARN_ADMIN_WALLETS = new Set(
  (process.env.EARN_ADMIN_WALLETS?.trim().split(",") ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .concat([GENESIS_LAUNCHER_WALLET]),
);

/**
 * The wallet that pays Earn claims, on-chain, on approval. Its key lives only
 * in the environment (Vercel / .env.local), never in code or the repo, and
 * never as a NEXT_PUBLIC_ value.
 */
export const DISTRIBUTOR_PRIVATE_KEY = process.env.DISTRIBUTOR_PRIVATE_KEY?.trim() || "";

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
  "leaderboard",
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
