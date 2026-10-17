import {
  keccak256,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
} from "viem";
import type { Hex, TransactionSerializable } from "viem";

/**
 * Turning a cloud KMS ECDSA signature into an Ethereum transaction.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. AWS KMS and Google Cloud KMS return
 * DER-encoded ECDSA over the digest they are handed. Ethereum needs fixed-width
 * r and s, a low-s value for transactions, and a recovery bit that KMS does not
 * return. That conversion is where a signer goes silently wrong: a valid
 * signature for the wrong parity produces a transaction that recovers to a
 * different sender, which the node rejects as an invalid signature. Keeping it
 * free of AWS and of `server-only` means it can be tested against a local key.
 *
 * NOTHING HERE SIGNS. It takes a digest signer as an argument, so the cloud call
 * is one line in `distributor-signer.ts` and this file has no credentials.
 */

/** secp256k1 group order and its half, for Ethereum's low-s rule. */
export const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const SECP256K1_HALF_N = SECP256K1_N / 2n;

function readInteger(bytes: Uint8Array): bigint {
  if (bytes.length === 0) throw new Error("KMS signature contains an empty integer");
  return BigInt(toHex(bytes));
}

/**
 * Parse `SEQUENCE { INTEGER r, INTEGER s }`.
 *
 * DER integers are signed and minimally encoded, so a 32-byte value with its
 * top bit set carries a leading 0x00. `BigInt` handles that fine; what it does
 * not handle is an empty integer, which is rejected rather than read as zero.
 * Long-form lengths are supported because the sequence can cross 127 bytes.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error("KMS signature is not a DER sequence");
  }

  let offset = 2;
  if (der[1] & 0x80) {
    const lengthBytes = der[1] & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 2 || offset + lengthBytes > der.length) {
      throw new Error("KMS signature has an unsupported DER length");
    }
    offset += lengthBytes;
  }

  const readPart = (): bigint => {
    if (offset + 2 > der.length || der[offset] !== 0x02) {
      throw new Error("KMS signature is missing a DER integer");
    }
    const length = der[offset + 1];
    const start = offset + 2;
    const end = start + length;
    if (length === 0 || end > der.length) {
      throw new Error("KMS signature has a malformed DER integer");
    }
    offset = end;
    return readInteger(der.slice(start, end));
  };

  const r = readPart();
  const s = readPart();
  return { r, s };
}

/**
 * Build a signed transaction from a DER signature, trying both recovery bits.
 *
 * KMS does not return `v`. Rather than guess, this serializes the transaction
 * with each parity and asks viem which one recovers the expected address. The
 * comparison is against the address configured for the key, so a signature from
 * the wrong key fails loudly instead of sending from an address nobody funded.
 *
 * Low-s is applied first. Flipping s changes which recovery bit is correct, and
 * because both bits are tried after the flip, no parity arithmetic is needed.
 */
export async function assembleSignedTransaction(
  transaction: TransactionSerializable,
  der: Uint8Array,
  expectedAddress: string,
): Promise<Hex> {
  const { r, s } = parseDerSignature(der);
  const lowS = s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
  const type =
    transaction.type ??
    (transaction.maxFeePerGas !== undefined || transaction.maxPriorityFeePerGas !== undefined
      ? "eip1559"
      : "legacy");
  const chainId = transaction.chainId ?? 0;
  const rHex = toHex(r, { size: 32 });
  const sHex = toHex(lowS, { size: 32 });

  for (const parity of [0, 1] as const) {
    const signature =
      type === "legacy"
        ? // EIP-155: v encodes the chain, so a legacy send cannot replay on another chain.
          { r: rHex, s: sHex, v: BigInt(chainId * 2 + 35 + parity) }
        : { r: rHex, s: sHex, yParity: parity };

    const serialized = serializeTransaction(transaction, signature as never);
    const recovered = await recoverTransactionAddress({ serializedTransaction: serialized });
    if (recovered.toLowerCase() === expectedAddress.toLowerCase()) return serialized;
  }

  throw new Error(
    "KMS signature did not recover to the configured distributor address — the key and DISTRIBUTOR_ADDRESS may not match",
  );
}

/** Sign an EIP-1559 (or legacy) transaction with any digest signer that returns DER. */
export async function signEvmTransaction(
  transaction: TransactionSerializable,
  expectedAddress: string,
  signDigest: (digest: Hex) => Promise<Uint8Array>,
): Promise<Hex> {
  const unsigned = serializeTransaction(transaction);
  const digest = keccak256(unsigned);
  const der = await signDigest(digest);
  return assembleSignedTransaction(transaction, der, expectedAddress);
}
