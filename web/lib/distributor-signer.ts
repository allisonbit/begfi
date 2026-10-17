import "server-only";

import type { Account, Hex, TransactionSerializable } from "viem";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signEvmTransaction } from "@/lib/kms-signature";

/**
 * The payout wallet's signer, chosen by configuration.
 *
 * KMS FIRST, PRIVATE KEY SECOND, NOTHING THIRD. When `AWS_KMS_KEY_ID` and
 * `DISTRIBUTOR_ADDRESS` are set, the key never enters the process; the server
 * sends a 32-byte digest to KMS and gets a signature back. The environment
 * private key stays as the fallback so an existing deployment does not stop
 * paying the moment this ships, and so the KMS path can be rolled back without
 * a code change.
 *
 * THE ADDRESS IS CONFIGURED, NOT DERIVED. Deriving it from the KMS public key
 * would make every synchronous caller (`distributorAddress()`, used in guards
 * and pages) async. `DISTRIBUTOR_ADDRESS` is public information, and the signer
 * verifies every signature against it: a mismatch between the key and the
 * address fails at signing time instead of sending from an unfunded wallet.
 *
 * KMS DOES NOT DERIVE CHILD KEYS. One KMS key signs for one address. Per-pool
 * deposit addresses therefore need either one key per pool or a forwarding
 * contract; that decision is separate from this signer.
 */
const PRIVATE_KEY = process.env.DISTRIBUTOR_PRIVATE_KEY?.trim() || "";
const KMS_KEY_ID = process.env.AWS_KMS_KEY_ID?.trim() || "";
const KMS_REGION = process.env.AWS_REGION?.trim() || "";
const KMS_ADDRESS = (process.env.DISTRIBUTOR_ADDRESS?.trim() || "").toLowerCase();

const PRIVATE_KEY_SET = /^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY);
const KMS_ADDRESS_VALID = /^0x[0-9a-f]{40}$/.test(KMS_ADDRESS);
const KMS_SET = Boolean(KMS_KEY_ID && KMS_REGION && KMS_ADDRESS_VALID);

/** Which signer is active, for logs and the admin console. Never includes a key. */
export function distributorSignerSource(): "kms" | "env-key" | "none" {
  if (KMS_SET) return "kms";
  if (PRIVATE_KEY_SET) return "env-key";
  return "none";
}

export function distributorSignerConfigured(): boolean {
  return KMS_SET || PRIVATE_KEY_SET;
}

/** The public address, available without a network call in either mode. */
export function distributorSignerAddress(): string | null {
  if (KMS_SET) return KMS_ADDRESS;
  if (!PRIVATE_KEY_SET) return null;
  return privateKeyToAccount(PRIVATE_KEY as Hex).address.toLowerCase();
}

async function kmsSignDigest(digest: Hex): Promise<Uint8Array> {
  // Imported lazily so a deployment using the env key never loads the AWS SDK.
  const { KMSClient, SignCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({ region: KMS_REGION });
  const result = await client.send(
    new SignCommand({
      KeyId: KMS_KEY_ID,
      // DIGEST means "sign these 32 bytes as given": KMS must not hash the
      // Ethereum transaction digest a second time.
      Message: hexToBytes(digest),
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }),
  );
  if (!result.Signature) throw new Error("KMS returned no signature");
  return result.Signature;
}

/**
 * The account handed to viem.
 *
 * Only `signTransaction` is implemented because sending is the only thing the
 * distributor does. Message and typed-data signing are deliberately absent: a
 * function that does not exist cannot be called by accident.
 */
export function distributorAccount(): Account | null {
  if (KMS_SET) {
    /*
     * Viem's `Account` union models a local key, a JSON-RPC account or a smart
     * account, not "a remote signer that only signs transactions". The casting
     * is confined to this boundary; `walletClient.sendTransaction` calls
     * `account.signTransaction(request, { serializer })` for anything that is
     * not a JSON-RPC account, which is exactly the shape below. Message and
     * typed-data signing are absent on purpose, so a future call that needs
     * them fails loudly instead of inventing a signature.
     */
    const kmsAccount = {
      address: KMS_ADDRESS as Hex,
      signTransaction: (transaction: TransactionSerializable) =>
        signEvmTransaction(transaction, KMS_ADDRESS, kmsSignDigest),
    };
    return kmsAccount as unknown as Account;
  }
  if (!PRIVATE_KEY_SET) return null;
  return privateKeyToAccount(PRIVATE_KEY as Hex);
}
