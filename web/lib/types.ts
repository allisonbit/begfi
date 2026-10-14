/**
 * Row shapes as they come back from `begfi.*`.
 *
 * `numeric(78,0)` arrives as a **string** from PostgREST, not a number — it
 * cannot fit in a JS number and the client does not pretend otherwise. Every
 * amount in this app is therefore carried as a string of base units and only
 * converted to bigint at the point of formatting or sending. That is deliberate:
 * a token balance that silently loses precision at 2^53 is a bug that shows up
 * as someone's money being wrong.
 */

export type Profile = {
  id: string;
  wallet_address: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  x_handle: string | null;
  x_verified: boolean;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
  /** Optional social links, shown on the public profile. */
  telegram_handle?: string | null;
  website_url?: string | null;
  /** When X verification last succeeded; the tick derives from it. */
  x_verified_at?: string | null;
};

/** What a public page is allowed to know about someone. */
export type PublicProfile = Pick<
  Profile,
  "username" | "display_name" | "bio" | "avatar_url" | "wallet_address" | "created_at"
>;

export type ProfileStats = {
  profile_id: string;
  total_received: string;
  supporters: number;
};

export type Transfer = {
  tx_hash: string;
  log_index: number;
  token_address: string;
  from_address: string;
  to_address: string;
  amount: string;
  block_number: number;
  block_time: string;
};

export type LaunchMode = "genesis" | "standard";

export type Launch = {
  token_address: string;
  launcher_wallet: string;
  name: string;
  ticker: string;
  image_url: string | null;
  mode: LaunchMode;
  splitter_address: string | null;
  tx_hash: string;
  created_at: string;
  /** What the launcher's socials struct carried, as submitted. Null for old rows. */
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
    farcaster?: string;
  } | null;
};

/** Public profile + its on-chain aggregates, as rendered on `/:username`. */
export type ProfileWithStats = PublicProfile & {
  stats: ProfileStats;
};
