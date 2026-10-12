import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Creator levels.
 *
 * THE RULE THE CHIP OBEYS: a level is a name for real on-chain aggregates —
 * confirmed $BEG received, confirmed supporters, recorded trade volume across
 * launched tokens — and never a badge someone earns by doing nothing on
 * chain. There is no badge collection: exactly one chip, computed the same
 * way everywhere it shows, and the thresholds below are the only place the
 * names live.
 *
 * The ordering of thresholds matters more than the numbers: a level is
 * reached only when every input clears the same row, so a creator cannot be
 * "Onchain" from volume and "Newborn" from zero supporters at the same time —
 * the chip shows the highest row ALL of whose inputs are met.
 */
export type Level = {
  name: string;
  /** Minimum confirmed $BEG received, in base units. */
  minReceived: bigint;
  /** Minimum distinct confirmed senders. */
  minSupporters: number;
  /** Minimum recorded 24h-ish volume across launched tokens, wei. */
  minVolumeWei: bigint;
};

// In base units (18 decimals). 1_000_000 $BEG etc. Volume in quote wei.
const MILLION = 1_000_000n * 10n ** 18n;
const HUNDRED_K = 100_000n * 10n ** 18n;
const TEN_K = 10_000n * 10n ** 18n;
const ONE_K = 1_000n * 10n ** 18n;

const ETH_VOL = (n: number) => BigInt(Math.round(n * 1e18));

export const LEVELS: Level[] = [
  { name: "Protocol", minReceived: 100n * MILLION, minSupporters: 500, minVolumeWei: ETH_VOL(50) },
  { name: "Legend", minReceived: 10n * MILLION, minSupporters: 200, minVolumeWei: ETH_VOL(10) },
  { name: "Onchain", minReceived: MILLION, minSupporters: 50, minVolumeWei: ETH_VOL(1) },
  { name: "Grinder", minReceived: HUNDRED_K, minSupporters: 10, minVolumeWei: ETH_VOL(0.1) },
  { name: "Asker", minReceived: TEN_K, minSupporters: 3, minVolumeWei: 0n },
  { name: "Newborn", minReceived: ONE_K, minSupporters: 1, minVolumeWei: 0n },
];

const STARTER: Level = {
  name: "Starting out",
  minReceived: 0n,
  minSupporters: 0,
  minVolumeWei: 0n,
};

export type LevelInputs = {
  totalReceivedWei: string;
  supporters: number;
  volumeWei: string;
};

export function levelFor(inputs: LevelInputs): string {
  const received = BigInt(inputs.totalReceivedWei);
  for (const l of LEVELS) {
    if (received >= l.minReceived && inputs.supporters >= l.minSupporters && BigInt(inputs.volumeWei) >= l.minVolumeWei) {
      return l.name;
    }
  }
  return STARTER.name;
}

/**
 * Level for one profile, from confirmed on-chain facts.
 *
 * Volume: the indexer's recorded trades on tokens this profile launched, all
 * time (not just 24h — a level that decays overnight would flicker for real
 * users and incentivise wash trading at exactly the wrong moment).
 */
// All-time trades are bounded by the table's own growth; the indexer only
// records catalog tokens, so this stays small for a young product.
export async function getLevelForWallet(
  wallet: string,
): Promise<{ name: string; receivedWei: string; supporters: number; volumeWei: string } | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const [statsRows, launchesRows] = await Promise.all([
    admin
      .from("transfers")
      .select("amount, from_address")
      .eq("to_address", wallet.toLowerCase())
      .limit(10_000),
    admin
      .from("launches")
      .select("token_address")
      .eq("launcher_wallet", wallet.toLowerCase())
      .limit(100),
  ]);

  let received = 0n;
  const senders = new Set<string>();
  for (const row of statsRows.data ?? []) {
    received += BigInt(row.amount);
    senders.add(row.from_address.toLowerCase());
  }

  const tokens = (launchesRows.data ?? []).map((r) => r.token_address as string);
  let volume = 0n;
  if (tokens.length > 0) {
    const { data: trades } = await admin
      .from("trades")
      .select("quote_amount")
      .in("token_address", tokens)
      .limit(50_000);
    for (const t of trades ?? []) volume += BigInt(t.quote_amount);
  }

  return {
    name: levelFor({
      totalReceivedWei: received.toString(),
      supporters: senders.size,
      volumeWei: volume.toString(),
    }),
    receivedWei: received.toString(),
    supporters: senders.size,
    volumeWei: volume.toString(),
  };
}
