#!/usr/bin/env node
/**
 * The local half of the AWS KMS import ceremony for the BegFi payout wallet.
 *
 * AWS cannot be handed a private key. The import protocol is: create a key in
 * PendingImport with EXTERNAL origin, fetch its RSA wrapping public key, encrypt
 * the raw secp256k1 private key to that public key locally, and hand only the
 * ciphertext to AWS. This script does the local encryption and the final proof.
 *
 * WHY IMPORT AT ALL. The payout wallet already holds funds and is named on the
 * site. A freshly generated KMS key would be a different address, and switching
 * to it would strand the funded one. Importing the existing key keeps
 * 0x5400ab13… and removes the private key from the server process.
 *
 * USAGE
 *   1. In AWS CloudShell: scripts/aws-kms-setup.sh --phase create
 *      It writes import-params.json. Copy that file here (or paste the JSON).
 *   2. node scripts/kms-import.mjs wrap --params import-params.json
 *      Writes kms-import/wrapped.bin and kms-import/import-token.bin, and prints
 *      their base64. Both are ciphertext and a one-time token, never the key.
 *   3. Back in CloudShell: scripts/aws-kms-setup.sh --phase import ...
 *      It signs the fixed verification digest and prints the DER signature.
 *   4. node scripts/kms-import.mjs verify --signature <base64 DER>
 *      Recovers the signer from that signature. It must print 0x5400ab13….
 *
 * The private key is read from DISTRIBUTOR_PRIVATE_KEY or web/.env.local and is
 * never printed, logged or written to disk.
 */
import { createPublicKey, publicEncrypt, constants } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, recoverAddress, toHex } from "viem";

/** The digest CloudShell signs. Fixed so the local side can check it exactly. */
export const VERIFICATION_DIGEST = keccak256(toHex("begfi-kms-verification"));

function privateKey() {
  const fromEnv = process.env.DISTRIBUTOR_PRIVATE_KEY?.trim();
  if (fromEnv) return fromEnv;

  const env = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
      }),
  );
  const value = env.DISTRIBUTOR_PRIVATE_KEY?.trim();
  if (!value) throw new Error("DISTRIBUTOR_PRIVATE_KEY is not set");
  return value;
}

/** A base64 SPKI public key from `get-parameters-for-import` as a Node PEM key. */
function pemFromSpki(base64) {
  const lines = base64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

function wrap(paramsPath) {
  const params = JSON.parse(readFileSync(paramsPath, "utf8"));
  const publicKey = params.PublicKey ?? params.publicKey;
  const importToken = params.ImportToken ?? params.importToken;
  if (!publicKey || !importToken) {
    throw new Error("import-params.json must contain PublicKey and ImportToken");
  }

  const key = privateKey();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("DISTRIBUTOR_PRIVATE_KEY is not a 32-byte hex key");
  const address = privateKeyToAccount(key).address;

  // AWS's RSAES_OAEP_SHA_256 is OAEP with SHA-256 for both the hash and MGF1,
  // which is what Node does when oaepHash is set.
  const wrapped = publicEncrypt(
    { key: createPublicKey(pemFromSpki(publicKey)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(key.slice(2), "hex"),
  );

  const dir = new URL("./kms-import/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("wrapped.bin", dir), wrapped);
  writeFileSync(new URL("import-token.bin", dir), Buffer.from(importToken, "base64"));

  console.log(`wallet address: ${address}`);
  console.log(`wrapped key   : ${wrapped.length} bytes, base64 below`);
  console.log(`\n${wrapped.toString("base64")}\n`);
  console.log("Files written to web/scripts/kms-import/: wrapped.bin, import-token.bin");
}

function readDer(bytes) {
  if (bytes[0] !== 0x30) throw new Error("signature is not a DER sequence");
  let offset = 2;
  if (bytes[1] & 0x80) offset += bytes[1] & 0x7f;
  const part = () => {
    if (bytes[offset] !== 0x02) throw new Error("signature is missing a DER integer");
    const length = bytes[offset + 1];
    const start = offset + 2;
    offset = start + length;
    let value = 0n;
    for (const byte of bytes.slice(start, start + length)) value = (value << 8n) | BigInt(byte);
    return value;
  };
  const r = part();
  const s = part();
  return { r, s };
}

async function verify(base64) {
  // KMS does not return the recovery bit, so both parities are tried and the one
  // that recovers a signer at all is reported. A wrong key still recovers to
  // some address, which is why the caller compares it to DISTRIBUTOR_ADDRESS.
  const { r, s } = readDer(Buffer.from(base64, "base64"));
  const expected = privateKeyToAccount(privateKey()).address;
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const lowS = s > n / 2n ? n - s : s;

  for (const yParity of [0, 1]) {
    const signature = { r: toHex(r, { size: 32 }), s: toHex(lowS, { size: 32 }), yParity };
    let recovered;
    try {
      recovered = await recoverAddress({ hash: VERIFICATION_DIGEST, signature });
    } catch {
      continue;
    }
    if (recovered.toLowerCase() === expected.toLowerCase()) {
      console.log(`recovered ${recovered}`);
      console.log(`expected  ${expected}`);
      console.log("MATCH: KMS signed with the configured distributor key");
      return;
    }
  }

  console.log(`DID NOT RECOVER to ${expected}. The imported key does not match the expected address.`);
  process.exitCode = 1;
}

const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};

if (mode === "wrap") {
  const params = flag("--params");
  if (!params) throw new Error("--params <import-params.json> is required");
  wrap(params);
} else if (mode === "verify") {
  const signature = flag("--signature");
  if (!signature) throw new Error("--signature <base64 DER> is required");
  await verify(signature);
} else {
  console.log("Usage: node scripts/kms-import.mjs wrap --params import-params.json");
  console.log("       node scripts/kms-import.mjs verify --signature <base64 DER>");
  process.exitCode = 1;
}
